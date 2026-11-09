using System;
using System.Collections.Generic;
using System.Collections;
using System.IO;
using System.Net;
using System.Text;
using System.Security.Cryptography;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Web.Script.Serialization;
using System.Threading;
using System.ServiceProcess;
using Microsoft.Win32;

namespace Armi.Student {
  public static class Data {
    public static JavaScriptSerializer Json {get{return new JavaScriptSerializer { MaxJsonLength = 4*1024*1024 };}}
    public static bool UserScope;
    public static string Home = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ARMI Estudiante");
    public static string S(IDictionary<string,object> d,string key) { object v; return d.TryGetValue(key,out v)&&v!=null?Convert.ToString(v):""; }
    public static bool B(IDictionary<string,object> d,string key) { object v; return d.TryGetValue(key,out v)&&v is bool&&(bool)v; }
    public static Dictionary<string,object> D(object value) { return (Dictionary<string,object>)value; }
    public static IEnumerable A(object value) { return (IEnumerable)value; }
    public static string Hash(byte[] bytes) { using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","").ToLowerInvariant(); }
    public static string FileHash(string path) { using(var sha=SHA256.Create())using(var stream=File.OpenRead(path))return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant(); }
    public static void Atomic(string path,byte[] bytes) {
      string temporary=path+"."+Guid.NewGuid().ToString("N")+".tmp";
      try { using(var stream=new FileStream(temporary,FileMode.CreateNew,FileAccess.Write,FileShare.None)){stream.Write(bytes,0,bytes.Length);stream.Flush(true);}
        if(File.Exists(path)) File.Replace(temporary,path,null); else File.Move(temporary,path);
      } finally { if(File.Exists(temporary))File.Delete(temporary); }
    }
    public static void Save(string name,object value,bool protect) {
      byte[] raw=Encoding.UTF8.GetBytes(Json.Serialize(value));
      if(protect)raw=ProtectedData.Protect(raw,null,UserScope?DataProtectionScope.CurrentUser:DataProtectionScope.LocalMachine);
      Atomic(Path.Combine(Home,name),raw);
    }
    public static Dictionary<string,object> Load(string name,bool protect) {
      string file=Path.Combine(Home,name);if(!File.Exists(file))return null;
      byte[] raw=File.ReadAllBytes(file);if(protect)raw=ProtectedData.Unprotect(raw,null,UserScope?DataProtectionScope.CurrentUser:DataProtectionScope.LocalMachine);
      return Json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(raw));
    }
    public static void ProtectDirectory(string path,bool readable) {
      var acl=new DirectorySecurity(); acl.SetAccessRuleProtection(true,false);
      acl.SetOwner(new SecurityIdentifier("S-1-5-32-544"));
      foreach(string sid in new[]{"S-1-5-18","S-1-5-32-544"})acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid),FileSystemRights.FullControl,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
      if(readable)acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier("S-1-5-32-545"),FileSystemRights.ReadAndExecute,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
      Directory.SetAccessControl(path,acl);
    }
    public static void Init() {
      if(Directory.Exists(Home)) {
        var owner=Directory.GetAccessControl(Home).GetOwner(typeof(SecurityIdentifier)).Value;
        if(owner!="S-1-5-18"&&owner!="S-1-5-32-544"&&!(Program.Admin()&&owner==WindowsIdentity.GetCurrent().User.Value))throw new IOException("La carpeta de configuración pertenece a otra cuenta. No se utilizará como servicio.");
      }
      Directory.CreateDirectory(Home);SafePaths.NoLinks(Home);ProtectDirectory(Home,false);Directory.CreateDirectory(Path.Combine(Home,"receipts"));
    }
    public static void Log(string message) {
      try { string file=Path.Combine(Home,"agent.log");if(File.Exists(file)&&new FileInfo(file).Length>512*1024)File.Delete(file);
        File.AppendAllText(file,DateTime.UtcNow.ToString("o")+" "+message+Environment.NewLine,Encoding.UTF8); }catch{}
    }
  }
  public static class SafePaths {
    internal static string SandboxRoot;
    public static void NoLinks(string target) {
      for(var dir=new DirectoryInfo(Path.GetFullPath(target));dir!=null;dir=dir.Parent)if(dir.Exists&&(dir.Attributes&FileAttributes.ReparsePoint)!=0)throw new IOException("La ruta contiene un enlace o punto de redirección.");
    }
    public static string Root(string value) {
      string root=Path.GetFullPath(value).TrimEnd('\\');
      if(!System.Text.RegularExpressions.Regex.IsMatch(root,@"^[A-Za-z]:\\")||root.Length<=3)throw new IOException("Selecciona una carpeta local, por ejemplo C:\\ARMI-Aula.");
      foreach(string special in (SandboxRoot!=null&&root.StartsWith(SandboxRoot+"\\",StringComparison.OrdinalIgnoreCase)?new string[0]:new[]{Environment.GetFolderPath(Environment.SpecialFolder.Windows),Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),Path.Combine(Path.GetPathRoot(root),"Users"),Path.Combine(Path.GetPathRoot(root),"Usuarios")}))
        if(!String.IsNullOrEmpty(special)&&(root.Equals(special,StringComparison.OrdinalIgnoreCase)||root.StartsWith(special.TrimEnd('\\')+"\\",StringComparison.OrdinalIgnoreCase)))throw new IOException("Usa una carpeta independiente de Windows y de los perfiles de usuario.");
      NoLinks(root);return root;
    }
    public static string Inside(string root,string relative) {
      return RelativeInside(Root(root),relative);
    }
    public static string RelativeInside(string root,string relative) {
      if(String.IsNullOrEmpty(relative)||relative.Length>180)throw new IOException("Ruta relativa no válida.");
      foreach(string part in relative.Replace('\\','/').Split('/')) {
        if(String.IsNullOrEmpty(part)||part=="."||part==".."||part.TrimEnd(' ','.')!=part||System.Text.RegularExpressions.Regex.IsMatch(part,@"[\x00-\x1f<>:""|?*]|^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)",System.Text.RegularExpressions.RegexOptions.IgnoreCase))throw new IOException("La ruta contiene un nombre no permitido.");
      }
      string target=Path.GetFullPath(Path.Combine(root,relative.Replace('/','\\')));
      if(!target.StartsWith(root+"\\",StringComparison.OrdinalIgnoreCase))throw new IOException("La ruta sale de la carpeta autorizada.");
      NoLinks(Path.GetDirectoryName(target));if(File.Exists(target)&&(File.GetAttributes(target)&FileAttributes.ReparsePoint)!=0)throw new IOException("El destino es un enlace.");
      return target;
    }
    public static string Prepare(string value,string knownRoot) {
      string root=Root(value),marker=Path.Combine(root,".armi-root");
      if(Directory.Exists(root)&&Directory.GetFileSystemEntries(root).Length>0&&(!root.Equals(knownRoot,StringComparison.OrdinalIgnoreCase)||!File.Exists(marker)))throw new IOException("La carpeta debe estar vacía. Los archivos existentes se conservaron.");
      Directory.CreateDirectory(root);Data.ProtectDirectory(root,true);
      if(!File.Exists(marker))File.WriteAllText(marker,"Carpeta administrada por ARMI Estudiante. Los estudiantes tienen acceso de lectura.");return root;
    }
  }
  public sealed class ApiException:Exception { public int Status;public ApiException(int status,string text):base(text){Status=status;} }
  public sealed class Api {
    public string Origin,Token;readonly int timeout;
    public Api(string origin,string token,int timeout=15000) { var u=new Uri(origin);if((u.Scheme!="http"&&u.Scheme!="https")||!String.IsNullOrEmpty(u.UserInfo)||u.AbsolutePath!="/"||!String.IsNullOrEmpty(u.Query)||!String.IsNullOrEmpty(u.Fragment))throw new ArgumentException("Escribe solo la dirección de ARMI y su puerto.");Origin=u.GetLeftPart(UriPartial.Authority);Token=token;this.timeout=timeout; }
    HttpWebRequest Request(string path,string method) {
      var request=(HttpWebRequest)WebRequest.Create(Origin+path);request.Method=method;request.Timeout=timeout;request.ReadWriteTimeout=timeout;request.AllowAutoRedirect=false;request.Proxy=null;
      if(!String.IsNullOrEmpty(Token))request.Headers[HttpRequestHeader.Authorization]="Bearer "+Token;return request;
    }
    public object Call(string path,object body) {
      var request=Request(path,body==null?"GET":"POST");
      if(body!=null){byte[] bytes=Encoding.UTF8.GetBytes(Data.Json.Serialize(body));request.ContentType="application/json";request.ContentLength=bytes.Length;using(var s=request.GetRequestStream())s.Write(bytes,0,bytes.Length);}
      try { using(var response=(HttpWebResponse)request.GetResponse())using(var reader=new StreamReader(response.GetResponseStream())) {
        if((int)response.StatusCode!=200)throw new ApiException((int)response.StatusCode,"La respuesta no es válida.");
        string text=reader.ReadToEnd();var result=Data.Json.Deserialize<Dictionary<string,object>>(text);if(!Data.B(result,"success"))throw new IOException(Data.S(result,"message"));return result["data"]; }
      }catch(WebException e){var response=e.Response as HttpWebResponse;if(response==null)throw;using(response){throw new ApiException((int)response.StatusCode,"ARMI respondió con estado "+(int)response.StatusCode+".");}}
    }
    public void Download(string url,string temporary,long expected) {
      if(!System.Text.RegularExpressions.Regex.IsMatch(url,@"^/api/student-agent/jobs/[a-f0-9-]{36}/file$"))throw new IOException("Dirección de descarga no válida.");
      var request=Request(url,"GET");request.Timeout=120000;request.ReadWriteTimeout=30000;try { using(var response=(HttpWebResponse)request.GetResponse()) {
        if((int)response.StatusCode!=200)throw new IOException("Descarga no autorizada.");
        if(response.ContentLength>expected)throw new IOException("Tamaño de descarga inesperado.");
        using(var input=response.GetResponseStream())using(var output=new FileStream(temporary,FileMode.CreateNew,FileAccess.Write,FileShare.None)) {
          var buffer=new byte[65536];long count=0;int n;while((n=input.Read(buffer,0,buffer.Length))>0){count+=n;if(count>expected||count>50*1024*1024)throw new IOException("El archivo supera su tamaño autorizado.");output.Write(buffer,0,n);}if(count!=expected)throw new IOException("Descarga incompleta.");output.Flush(true);
        }
      }}catch(WebException e){var response=e.Response as HttpWebResponse;if(response!=null){int status=(int)response.StatusCode;response.Close();throw new ApiException(status,"La descarga ya no está disponible.");}throw;}
    }
  }
  public sealed class Agent {
    readonly WebPolicies web;
    public Agent(WebPolicies policies) { web=policies; }
    public static bool Allowed(Dictionary<string,object> policy,Dictionary<string,object> config,string key) { return Data.B(Data.D(policy["permissions"]),key)&&Data.B(Data.D(config["capabilities"]),key); }
    public string ApplyJob(Dictionary<string,object> job,Dictionary<string,object> policy,Dictionary<string,object> config,Api api) {
      string id=Data.S(job,"id"),type=Data.S(job,"type");Guid guid;if(!Guid.TryParse(id,out guid))throw new IOException("Identificador de orden no válido.");
      string permission=(type=="create-folder"||type=="rename-folder")?"folders":type=="receive-file"?"files":"";
      if(permission==""||!Allowed(policy,config,permission))throw new IOException("La acción no está autorizada para este equipo.");
      string root=SafePaths.Root(Data.S(config,"rootPath"));if(!File.Exists(Path.Combine(root,".armi-root")))throw new IOException("La carpeta autorizada ya no está disponible.");
      string target=SafePaths.Inside(root,Data.S(job,"relativePath"));
      if(Path.GetFileName(target).StartsWith(".armi-",StringComparison.OrdinalIgnoreCase))throw new IOException("El nombre está reservado por ARMI.");
      string fingerprint=Data.Hash(Encoding.UTF8.GetBytes(Data.Json.Serialize(job))),receipt="receipts/"+id+".json";var previous=Data.Load(receipt,false);
      if(previous!=null&&Data.S(previous,"hash")!=fingerprint)throw new IOException("Se rechazó una orden con identificador reutilizado.");
      if(previous!=null&&Data.S(previous,"state")=="success")return Data.S(previous,"message");
      Data.Save(receipt,new {hash=fingerprint,state="started"},false);string message;
      if(type=="create-folder") { Directory.CreateDirectory(target);SafePaths.NoLinks(target);message="Carpeta disponible."; }
      else if(type=="rename-folder") {string renamed=SafePaths.Inside(root,Data.S(job,"newRelativePath"));Directory.Move(target,renamed);message="Carpeta renombrada.";}
      else {
        var file=Data.D(job["file"]);long size=Convert.ToInt64(file["size"]);string hash=Data.S(file,"sha256");
        if(size<0||size>50*1024*1024||!System.Text.RegularExpressions.Regex.IsMatch(hash,"^[a-f0-9]{64}$"))throw new IOException("Datos del archivo no válidos.");
        if(File.Exists(target)){if(Data.FileHash(target)!=hash)throw new IOException("Ya existe un archivo diferente. Se conservó sin cambios.");message="El archivo ya estaba disponible.";}
        else {Directory.CreateDirectory(Path.GetDirectoryName(target));SafePaths.NoLinks(Path.GetDirectoryName(target));string temporary=Path.Combine(root,".armi-"+id+".tmp");
          try {if(File.Exists(temporary))File.Delete(temporary);api.Download(Data.S(file,"url"),temporary,size);if(Data.FileHash(temporary)!=hash)throw new IOException("La huella del archivo no coincide.");SafePaths.Inside(root,Data.S(job,"relativePath"));File.Move(temporary,target);message="Archivo recibido y verificado.";}
          finally {if(File.Exists(temporary))File.Delete(temporary);}
        }
      }
      Data.Save(receipt,new {hash=fingerprint,state="success",message=message},false);return message;
    }
    public void Tick() {
      var config=Data.Load("settings.dat",true);if(config==null||String.IsNullOrEmpty(Data.S(config,"token"))||Coordinator.IsChanging()){if(SafePaths.SandboxRoot!=null)return;config=Coordinator.Ensure();if(config==null)return;}
      var api=new Api(Data.S(config,"server"),Data.S(config,"token"));
      try {
        if(Data.S(config,"serverId")==""&&SafePaths.SandboxRoot==null){Coordinator.BeginChange();return;}
        if(Data.S(config,"serverId")!="")Discovery.VerifyEndpoint(api.Origin,Data.S(config,"serverId"),Data.S(config,"modulus"));
        var policy=Data.D(api.Call("/api/student-agent/policy",null));string state="disabled",error="";int count=0;
        Data.Save("browser-policy.json",policy,false);
        try {var domains=new List<string>();if(Allowed(policy,config,"navigation"))foreach(var domain in Data.A(policy["domains"]))domains.Add(Convert.ToString(domain));
          web.Apply(domains,new Uri(api.Origin));count=domains.Count;state=Allowed(policy,config,"navigation")?"configured":"disabled";
        }catch(Exception e){state="error";error=e.Message;Data.Log("Políticas web: "+error);}
        api.Call("/api/student-agent/heartbeat",new {revision=Data.S(policy,"revision"),navigationState=state,blockedCount=count,rootPath=Data.S(config,"rootPath"),capabilities=config["capabilities"],machineName=Environment.MachineName,version=Program.Version,error=error});
        foreach(var item in Data.A(api.Call("/api/student-agent/jobs",null))) {
          var job=Data.D(item);string result="success",message;
          try{message=ApplyJob(job,policy,config,api);}catch(WebException){throw;}catch(ApiException e){if(e.Status==401||e.Status>=500)throw;result="error";message=e.Message;}catch(Exception e){result="error";message=e.Message;}
          api.Call("/api/student-agent/jobs/"+Data.S(job,"id")+"/result",new {state=result,message=message});
        }
        Data.Save("status.json",new {updatedAt=DateTime.UtcNow.ToString("o"),state=state,error=error},false);
        Coordinator.State(state=="error"?"warning":"connected",state=="error"?"Equipo vinculado. Hay un aviso en las políticas web; revisa ARMI Docente.":"Autoconfiguración completada. Conectado con ARMI Docente.",new object[0]);
      }catch(ApiException e){if(e.Status==401){web.Apply(new List<string>(),new Uri(api.Origin));config["token"]="";Data.Save("settings.dat",config,true);Data.Save("browser-policy.json",new {revoked=true},false);Coordinator.State("revoked","El docente retiró la vinculación.",new object[0]);Data.Log("Vinculación retirada. Se liberaron las políticas propias de ARMI.");}else {if(SafePaths.SandboxRoot==null)Coordinator.Rediscover(config);throw;}}
      catch(Exception){if(SafePaths.SandboxRoot==null)Coordinator.Rediscover(config);throw;}
    }
  }
  public sealed class AgentService:ServiceBase {
    Thread worker,bridge;readonly ManualResetEvent stop=new ManualResetEvent(false);
    public AgentService(){ServiceName="ARMIStudentAgent";CanStop=true;AutoLog=true;}
    protected override void OnStart(string[] args){worker=new Thread(Loop);worker.IsBackground=true;worker.Start();}
    void Loop(){try{Data.Init();bridge=new Thread(()=>SessionBridge.Run(stop));bridge.IsBackground=true;bridge.Start();var agent=new Agent(new WebPolicies());while(!stop.WaitOne(0)){try{WindowsSession.EnsureTray();agent.Tick();}catch(Exception e){Data.Log(e.GetType().Name+": "+e.Message);}stop.WaitOne(10000);}}catch(Exception e){Data.Log("Inicio: "+e.Message);Stop();}}
    protected override void OnStop(){stop.Set();if(worker!=null)worker.Join(20000);}
  }
}
