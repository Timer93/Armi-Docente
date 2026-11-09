using System;
using System.IO;
using System.Collections.Generic;
using Microsoft.Win32;
namespace Armi.Student {
  static class SelfTest {
    static void Check(bool value,string name){if(!value)throw new Exception("Prueba fallida: "+name);}
    public static void Run(){
      System.Windows.Forms.Application.EnableVisualStyles();
      string original=Data.Home,temp=Path.Combine(Path.GetTempPath(),"armi-agent-test-"+Guid.NewGuid().ToString("N")),registry=@"Software\ARMI\StudentAgentTest\"+Guid.NewGuid().ToString("N");
      Directory.CreateDirectory(temp);Data.Home=temp;SafePaths.SandboxRoot=temp;Directory.CreateDirectory(Path.Combine(temp,"receipts"));
      try {
        Data.Save("secret.dat",new {token="test-token"},true);Check(Data.S(Data.Load("secret.dat",true),"token")=="test-token","DPAPI roundtrip");Check(!System.Text.Encoding.UTF8.GetString(File.ReadAllBytes(Path.Combine(temp,"secret.dat"))).Contains("test-token"),"DPAPI encrypted");
        string root=Path.Combine(temp,"root");Directory.CreateDirectory(root);File.WriteAllText(Path.Combine(root,".armi-root"),"test");
        foreach(string bad in new[]{"../escape","C:\\Windows","a//b","con.txt","a. ","x:file","a/../../b","/absolute","a/./b"}){bool rejected=false;try{SafePaths.Inside(root,bad);}catch(IOException){rejected=true;}Check(rejected,"reject "+bad);}
        var web=new WebPolicies(Registry.CurrentUser,new[]{registry},"policies.json");
        using(var key=Registry.CurrentUser.CreateSubKey(registry+@"\URLBlocklist"))key.SetValue("1","institution.example");
        web.Apply(new List<string>{"example.com","school.test"},new Uri("http://teacher.test:3001"));
        using(var key=Registry.CurrentUser.OpenSubKey(registry+@"\URLBlocklist")){Check(Convert.ToString(key.GetValue("1"))=="institution.example","preserve policy");Check(key.ValueCount==3,"apply policies");}
        web.Apply(new List<string>{"example.com"},new Uri("http://teacher.test:3001"));
        web.Apply(new List<string>(),new Uri("http://teacher.test:3001"));
        using(var key=Registry.CurrentUser.OpenSubKey(registry+@"\URLBlocklist")){Check(key.ValueCount==1,"remove only own policies");Check(Convert.ToString(key.GetValue("1"))=="institution.example","institution still present");}
        var agent=new Agent(web);var cap=new Dictionary<string,object>{{"navigation",true},{"folders",true},{"files",true}};
        var config=new Dictionary<string,object>{{"rootPath",root},{"capabilities",cap}};
        var policy=new Dictionary<string,object>{{"permissions",cap}};
        string id=Guid.NewGuid().ToString();var job=new Dictionary<string,object>{{"id",id},{"type","create-folder"},{"relativePath","Unidad 7/Materiales"}};
        agent.ApplyJob(job,policy,config,null);agent.ApplyJob(job,policy,config,null);Check(Directory.Exists(Path.Combine(root,@"Unidad 7\Materiales")),"idempotent directory");
        job["relativePath"]="Other";bool reuse=false;try{agent.ApplyJob(job,policy,config,null);}catch(IOException){reuse=true;}Check(reuse,"job ID fingerprint");
        byte[] content=System.Text.Encoding.UTF8.GetBytes("Original del estudiante");File.WriteAllBytes(Path.Combine(root,"archivo.txt"),content);
        var fileJob=new Dictionary<string,object>{{"id",Guid.NewGuid().ToString()},{"type","receive-file"},{"relativePath","archivo.txt"},{"file",new Dictionary<string,object>{{"size",content.Length},{"sha256",Data.Hash(content)},{"url","/unused"}}}};
        agent.ApplyJob(fileJob,policy,config,null);
        fileJob["id"]=Guid.NewGuid().ToString();Data.D(fileJob["file"])["sha256"]=new string('0',64);bool preserved=false;try{agent.ApplyJob(fileJob,policy,config,null);}catch(IOException){preserved=true;}
        Check(preserved&&Data.FileHash(Path.Combine(root,"archivo.txt"))==Data.Hash(content),"never overwrite different file");
        Check(Array.IndexOf(typeof(Discovery).Assembly.GetManifestResourceNames(),"ArmiTrustedTeacher")<0,"generic installer contains no teacher identity");
        Check(!Coordinator.IsKnown(new Dictionary<string,object>{{"serverId",Guid.NewGuid().ToString()},{"modulus","new"}}),"new teachers require verification");
        using(var form=new AutoForm(true)){form.Opacity=0;form.Show();System.Windows.Forms.Application.DoEvents();using(var bitmap=new System.Drawing.Bitmap(form.Width,form.Height)){form.DrawToBitmap(bitmap,new System.Drawing.Rectangle(0,0,bitmap.Width,bitmap.Height));bitmap.Save(Path.Combine(Path.GetTempPath(),"armi-student-setup-preview.png"),System.Drawing.Imaging.ImageFormat.Png);}Check(!form.ShowInTaskbar,"no taskbar button");form.Hide();}
        Data.Save("settings.dat",new {token="never-expose-this-secret",server="http://127.0.0.1:3001"},true);Data.Save("browser-policy.json",new {protocol=1,deviceId="test",domains=new[]{"example.com"},revision=new string('a',64)},false);
        string priorPipe=SessionBridge.Name;SessionBridge.Name="ARMI.Student.Session.Test."+Guid.NewGuid().ToString("N");
        using(var stop=new System.Threading.ManualResetEvent(false)){
          var listener=new System.Threading.Thread(()=>SessionBridge.Run(stop));listener.IsBackground=true;listener.Start();
          try {
            var snapshot=SessionBridge.Call(new {type="status"});Check(Data.B(snapshot,"paired"),"authenticated local pipe snapshot");Check(!Data.Json.Serialize(snapshot).Contains("never-expose-this-secret"),"pipe status never exposes service credential");
            var info=new System.Diagnostics.ProcessStartInfo(System.Windows.Forms.Application.ExecutablePath,"--sandbox-native-host "+SessionBridge.Name){UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true};
            using(var child=System.Diagnostics.Process.Start(info)){
              byte[] body=System.Text.Encoding.UTF8.GetBytes("{\"type\":\"policy\"}");child.StandardInput.BaseStream.Write(BitConverter.GetBytes(body.Length),0,4);child.StandardInput.BaseStream.Write(body,0,body.Length);child.StandardInput.BaseStream.Flush();child.StandardInput.Close();
              byte[] header=new byte[4];int count=child.StandardOutput.BaseStream.Read(header,0,4);Check(count==4,"native messaging frame");int size=BitConverter.ToInt32(header,0);var bytes=new byte[size];int offset=0;while(offset<size){int read=child.StandardOutput.BaseStream.Read(bytes,offset,size-offset);if(read==0)throw new Exception("Truncated native host response");offset+=read;}
              string response=System.Text.Encoding.UTF8.GetString(bytes);Check(Data.B(Data.Json.Deserialize<Dictionary<string,object>>(response),"success")&&!response.Contains("never-expose-this-secret"),"real native messaging bridge without credentials");Check(child.WaitForExit(10000)&&child.ExitCode==0,"native host exit");
            }
          }finally{stop.Set();listener.Join(4000);SessionBridge.Name=priorPipe;}
        }
        File.WriteAllText(Path.Combine(temp,"self-test-ok.json"),"{\"success\":true}");
        File.WriteAllText(Path.Combine(Path.GetTempPath(),"armi-student-self-test.json"),"{\"success\":true,\"tests\":[\"DPAPI\",\"traversal\",\"policy preservation\",\"idempotency\",\"original file preservation\",\"teacher pin\",\"WinForms\",\"local IPC\",\"native messaging\"]}");
      }finally {Registry.CurrentUser.DeleteSubKeyTree(registry,false);Data.Home=original;SafePaths.SandboxRoot=null;if(Path.GetFullPath(temp).StartsWith(Path.GetTempPath(),StringComparison.OrdinalIgnoreCase))Directory.Delete(temp,true);}
    }
  }
}
