using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Collections.Generic;

namespace Armi.Student {
  public static class SessionBridge {
    public static string Name="ARMI.Student.Session.v2";
    public static Dictionary<string,object> Call(object value){using(var pipe=new NamedPipeClientStream(".",Name,PipeDirection.InOut,PipeOptions.Asynchronous,TokenImpersonationLevel.Identification)){
      pipe.Connect(2500);byte[] raw=Encoding.UTF8.GetBytes(Data.Json.Serialize(value)+"\n");pipe.Write(raw,0,raw.Length);pipe.Flush();
      var task=new StreamReader(pipe,Encoding.UTF8).ReadLineAsync();if(!task.Wait(8000))throw new IOException("El servicio no respondió a tiempo.");
      var result=Data.Json.Deserialize<Dictionary<string,object>>(task.Result);if(!Data.B(result,"success"))throw new IOException(Data.S(result,"message"));return Data.D(result["data"]);
    }}
    public static void Run(ManualResetEvent stop){
      while(!stop.WaitOne(0))try{
        var security=new PipeSecurity();security.SetAccessRuleProtection(true,false);security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier("S-1-5-2"),PipeAccessRights.ReadWrite,AccessControlType.Deny));
        foreach(string sid in new[]{"S-1-5-18","S-1-5-32-544","S-1-5-4"})security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(sid),PipeAccessRights.ReadWrite,AccessControlType.Allow));
        using(var pipe=new NamedPipeServerStream(Name,PipeDirection.InOut,1,PipeTransmissionMode.Byte,PipeOptions.Asynchronous,4096,4096,security)){
          var wait=pipe.BeginWaitForConnection(null,null);int ready=WaitHandle.WaitAny(new[]{wait.AsyncWaitHandle,stop});if(ready==1)return;pipe.EndWaitForConnection(wait);
          var read=new StreamReader(pipe,Encoding.UTF8).ReadLineAsync();if(!read.Wait(2500))continue;if(read.Result==null||read.Result.Length>4096)continue;
          var request=Data.Json.Deserialize<Dictionary<string,object>>(read.Result);Dictionary<string,object> reply;
          try {reply=new Dictionary<string,object>{{"success",true},{"data",Handle(pipe,request)}};}catch(Exception e){reply=new Dictionary<string,object>{{"success",false},{"message",e.Message}};}
          byte[] bytes=Encoding.UTF8.GetBytes(Data.Json.Serialize(reply)+"\n");var write=pipe.WriteAsync(bytes,0,bytes.Length);write.Wait(2500);
        }
      }catch(Exception e){if(!stop.WaitOne(1000))Data.Log("Sesión: "+e.Message);}
    }
    static object Handle(NamedPipeServerStream pipe,Dictionary<string,object> request){
      string type=Data.S(request,"type");
      if(type=="status"||type=="browser-policy"){
        Dictionary<string,object> config=Data.Load("settings.dat",true),state=Data.Load("setup-state.json",false),policy=Data.Load("browser-policy.json",false);
        var identity=Data.Load("installation.dat",true);
        return new {setup=state,paired=config!=null&&Data.S(config,"token")!="",changing=identity!=null&&Data.B(identity,"changing"),enrollment=config==null?"":Data.S(config,"enrollment"),server=config==null?"":Data.S(config,"server"),machineName=Environment.MachineName,policy=policy};
      }
      if(type!="session"&&type!="select-teacher"&&type!="confirm-teacher"&&type!="change-teacher"&&type!="cancel-teacher-change")throw new IOException("Solicitud local no admitida.");
      uint pid;if(!WindowsSession.GetNamedPipeClientProcessId(pipe.SafePipeHandle.DangerousGetHandle(),out pid))throw new IOException("No se pudo identificar la sesión.");
      int session;using(var client=Process.GetProcessById((int)pid)){session=client.SessionId;}
      if(session==0||session!=WindowsSession.ActiveSession())throw new IOException("Se requiere la sesión activa del estudiante.");
      if(!WindowsSession.IsInstalledClient(pid))throw new IOException("El cliente de sesión no pertenece a ARMI.");
      if(type=="select-teacher"){Coordinator.SelectTeacher(Data.S(request,"serverId"));return new {accepted=true};}
      if(type=="confirm-teacher"){Coordinator.ConfirmTeacher(Data.S(request,"verificationCode"));return new {accepted=true};}
      if(type=="change-teacher"){Coordinator.BeginChange();return new {accepted=true};}
      if(type=="cancel-teacher-change"){Coordinator.CancelChange();return new {accepted=true};}
      string user=pipe.GetImpersonationUserName();var sid=((SecurityIdentifier)new NTAccount(user).Translate(typeof(SecurityIdentifier))).Value;
      var settings=Data.Load("settings.dat",true);if(settings==null||Data.S(settings,"token")=="")throw new IOException("Esperando vinculación con el docente.");
      if(Data.S(settings,"serverId")!="")Discovery.VerifyEndpoint(Data.S(settings,"server"),Data.S(settings,"serverId"),Data.S(settings,"modulus"));
      var result=Data.D(new Api(Data.S(settings,"server"),Data.S(settings,"token")).Call("/api/student-agent/session",new {sid=sid,username=user}));
      return new {server=Data.S(settings,"server"),serverId=Data.S(settings,"serverId"),modulus=Data.S(settings,"modulus"),token=Data.S(result,"token"),policy=result["policy"],rootPath=Data.S(settings,"rootPath"),capabilities=settings["capabilities"],enrollment=Data.S(result,"enrollment")};
    }
    public static void Native(){
      using(var input=Console.OpenStandardInput())using(var output=Console.OpenStandardOutput()){
        byte[] length=new byte[4];ReadExact(input,length);int size=BitConverter.ToInt32(length,0);if(size<1||size>4096)return;byte[] body=new byte[size];ReadExact(input,body);
        object result;try{var message=Data.Json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(body));if(Data.S(message,"type")!="policy")throw new IOException("Solicitud no admitida.");result=new {success=true,data=Call(new {type="browser-policy"})};}catch(Exception e){result=new {success=false,message=e.Message};}
        byte[] reply=Encoding.UTF8.GetBytes(Data.Json.Serialize(result));if(reply.Length>1024*1024)reply=Encoding.UTF8.GetBytes("{\"success\":false,\"message\":\"La política supera el tamaño admitido por el navegador.\"}");output.Write(BitConverter.GetBytes(reply.Length),0,4);output.Write(reply,0,reply.Length);output.Flush();
      }
    }
    static void ReadExact(Stream stream,byte[] bytes){int offset=0;while(offset<bytes.Length){int n=stream.Read(bytes,offset,bytes.Length-offset);if(n==0)throw new EndOfStreamException();offset+=n;}}
  }
  public static class WindowsSession {
    [DllImport("kernel32.dll",SetLastError=true)]public static extern bool GetNamedPipeClientProcessId(IntPtr pipe,out uint pid);
    [DllImport("kernel32.dll")]static extern uint WTSGetActiveConsoleSessionId();
    [DllImport("wtsapi32.dll",SetLastError=true)]static extern bool WTSEnumerateSessions(IntPtr server,int reserved,int version,out IntPtr sessions,out int count);
    [DllImport("wtsapi32.dll")]static extern void WTSFreeMemory(IntPtr memory);
    [DllImport("wtsapi32.dll",SetLastError=true)]static extern bool WTSQueryUserToken(uint session,out IntPtr token);
    [DllImport("kernel32.dll")]static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool QueryFullProcessImageName(IntPtr process,uint flags,StringBuilder name,ref uint size);
    [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
    [DllImport("userenv.dll",SetLastError=true)]static extern bool CreateEnvironmentBlock(out IntPtr environment,IntPtr token,bool inherit);
    [DllImport("userenv.dll")]static extern bool DestroyEnvironmentBlock(IntPtr environment);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool CreateProcessAsUser(IntPtr token,string application,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string directory,ref Startup startup,out ProcessInformation process);
    [DllImport("advapi32.dll",SetLastError=true)]static extern bool GetTokenInformation(IntPtr token,int informationClass,IntPtr information,int size,out int returned);
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]struct Startup {public int cb;public string reserved,desktop,title;public int x,y,width,height,xChars,yChars,fill,flags;public short show,reserved2;public IntPtr reservedPtr,input,output,error;}
    [StructLayout(LayoutKind.Sequential)]struct ProcessInformation {public IntPtr process,thread;public int pid,tid;}
    [StructLayout(LayoutKind.Sequential)]struct WtsSession {public int id;public IntPtr station;public int state;}
    public static int ActiveSession(){int console=(int)WTSGetActiveConsoleSessionId(),active=-1;IntPtr sessions;int count;
      if(!WTSEnumerateSessions(IntPtr.Zero,0,1,out sessions,out count))return console;
      try {int size=Marshal.SizeOf(typeof(WtsSession));for(int i=0;i<count;i++){var session=(WtsSession)Marshal.PtrToStructure(IntPtr.Add(sessions,i*size),typeof(WtsSession));if(session.state==0){if(session.id==console)return console;if(active<0)active=session.id;}}return active;}finally{WTSFreeMemory(sessions);}
    }
    public static bool IsInstalledClient(uint pid){IntPtr process=OpenProcess(0x1000,false,pid);if(process==IntPtr.Zero)return false;try{var name=new StringBuilder(1024);uint size=1024;return QueryFullProcessImageName(process,0,name,ref size)&&Path.GetFullPath(name.ToString()).Equals(System.Windows.Forms.Application.ExecutablePath,StringComparison.OrdinalIgnoreCase);}finally{CloseHandle(process);}}
    public static void EnsureTray(){
      int session=ActiveSession();if(session<0)return;foreach(var p in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(System.Windows.Forms.Application.ExecutablePath)))using(p)try{if(p.SessionId==session&&IsInstalledClient((uint)p.Id))return;}catch{}
      IntPtr token;if(!WTSQueryUserToken((uint)session,out token))return;IntPtr environment=IntPtr.Zero;
      try {
        IntPtr info=Marshal.AllocHGlobal(IntPtr.Size);try{int returned;if(GetTokenInformation(token,18,info,4,out returned)&&Marshal.ReadInt32(info)==2&&GetTokenInformation(token,19,info,IntPtr.Size,out returned)){IntPtr limited=Marshal.ReadIntPtr(info);CloseHandle(token);token=limited;}}finally{Marshal.FreeHGlobal(info);}
        CreateEnvironmentBlock(out environment,token,false);var startup=new Startup{cb=Marshal.SizeOf(typeof(Startup)),desktop=@"winsta0\default"};ProcessInformation result;
        string exe=System.Windows.Forms.Application.ExecutablePath;if(!CreateProcessAsUser(token,exe,new StringBuilder("\""+exe+"\" --tray"),IntPtr.Zero,IntPtr.Zero,false,0x400,environment,Path.GetDirectoryName(exe),ref startup,out result))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());CloseHandle(result.process);CloseHandle(result.thread);
      }finally{if(environment!=IntPtr.Zero)DestroyEnvironmentBlock(environment);CloseHandle(token);}
    }
  }
}
