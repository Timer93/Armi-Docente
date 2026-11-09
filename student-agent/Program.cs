using System;
using System.IO;
using System.Drawing;
using System.Diagnostics;
using System.Collections.Generic;
using System.Security.Principal;
using System.ServiceProcess;
using System.Windows.Forms;

namespace Armi.Student {
  static class Program {
    public const string Service="ARMIStudentAgent";
    public const string Version="1.3.0";
    static void ReportUninstall(){
      var config=Data.Load("settings.dat",true);if(config==null)return;
      try{if(Data.S(config,"token")!=""){if(Data.S(config,"serverId")=="")throw new IOException("No hay identidad docente verificada.");Discovery.VerifyEndpoint(Data.S(config,"server"),Data.S(config,"serverId"),Data.S(config,"modulus"),2500);new Api(Data.S(config,"server"),Data.S(config,"token"),2500).Call("/api/student-agent/uninstall",new {version=Version});}}
      catch(Exception e){Data.Log("No se pudo avisar la desinstalación al docente: "+e.Message);}
      finally{config["token"]="";Data.Save("settings.dat",config,true);Data.Save("browser-policy.json",new {revoked=true},false);}
    }
    public static bool Admin(){return new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);}
    static void Sc(string args){var info=new ProcessStartInfo("sc.exe",args){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};using(var p=Process.Start(info)){string output=p.StandardOutput.ReadToEnd()+p.StandardError.ReadToEnd();p.WaitForExit();if(p.ExitCode!=0)throw new IOException(output);}}
    public static void StopService(){using(var c=new ServiceController(Service)){try{if(c.Status!=ServiceControllerStatus.Stopped){c.Stop();c.WaitForStatus(ServiceControllerStatus.Stopped,TimeSpan.FromSeconds(30));}}catch(InvalidOperationException){}}}
    public static void StartService(){using(var c=new ServiceController(Service)){if(c.Status!=ServiceControllerStatus.Running){c.Start();c.WaitForStatus(ServiceControllerStatus.Running,TimeSpan.FromSeconds(30));}}}
    static void CloseClients(){foreach(var p in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(Application.ExecutablePath)))using(p)try{if(p.Id!=Process.GetCurrentProcess().Id&&p.SessionId!=0&&WindowsSession.IsInstalledClient((uint)p.Id)){p.Kill();p.WaitForExit(5000);}}catch{}}
    static void BrowserHost(bool remove){
      string host=Path.Combine(Application.StartupPath,"native-host.json");
      if(!remove){var manifest=Data.Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(Application.StartupPath,"native-host.template.json")));manifest["path"]=Application.ExecutablePath;File.WriteAllText(host,Data.Json.Serialize(manifest));}
      foreach(var view in new[]{Microsoft.Win32.RegistryView.Registry32,Microsoft.Win32.RegistryView.Registry64})using(var hive=Microsoft.Win32.RegistryKey.OpenBaseKey(Microsoft.Win32.RegistryHive.LocalMachine,view))foreach(string browser in new[]{@"SOFTWARE\Google\Chrome\NativeMessagingHosts\org.armi.student",@"SOFTWARE\Microsoft\Edge\NativeMessagingHosts\org.armi.student"}){
        if(remove){using(var key=hive.OpenSubKey(browser))if(key==null||Convert.ToString(key.GetValue(""))!=host)continue;hive.DeleteSubKey(browser,false);}else using(var key=hive.CreateSubKey(browser))key.SetValue("",host);
      }
      using(var key=Microsoft.Win32.Registry.LocalMachine.CreateSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Run")){string command="\""+Application.ExecutablePath+"\" --tray";if(remove){if(Convert.ToString(key.GetValue("ARMI Estudiante"))==command)key.DeleteValue("ARMI Estudiante",false);}else key.SetValue("ARMI Estudiante",command);}
    }
    [STAThread] static int Main(string[] args) {
      try {
        ServicePointSetup();
        string command=args.Length==0?"--configure":args[0];
        if(command=="--self-test"){SelfTest.Run();return 0;}
        if(command=="--sandbox-native-host") {if(args.Length!=2||!args[1].StartsWith("ARMI.Student.Session.Test.",StringComparison.Ordinal))return 1;SessionBridge.Name=args[1];SessionBridge.Native();return 0;}
        if(command.StartsWith("chrome-extension://",StringComparison.Ordinal)||command=="--native-host"){SessionBridge.Native();return 0;}
        if(command=="--tray"||command=="--configure"){
          bool first;using(var mutex=new System.Threading.Mutex(true,"Local\\ARMI.Student.Tray."+WindowsIdentity.GetCurrent().User.Value,out first)){
            if(!first)return 0;
            Data.Home=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"ARMI Estudiante");Data.UserScope=true;Directory.CreateDirectory(Data.Home);Directory.CreateDirectory(Path.Combine(Data.Home,"receipts"));
            Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);Application.Run(new AutoForm());return 0;
          }
        }
        if(command=="--service"){ServiceBase.Run(new AgentService());return 0;}
        if(command=="--sandbox-discover"){
          if(args.Length!=3||!Path.GetFullPath(args[1]).StartsWith(Path.GetTempPath(),StringComparison.OrdinalIgnoreCase))throw new IOException("La prueba requiere una carpeta temporal.");
          int port=Int32.Parse(args[2]);File.WriteAllText(Path.Combine(args[1],"discovery.json"),Data.Json.Serialize(Discovery.Find(port,true)));return 0;
        }
        if(command=="--sandbox-auto-step"){
          if(args.Length!=3||!Path.GetFullPath(args[1]).StartsWith(Path.GetTempPath(),StringComparison.OrdinalIgnoreCase))throw new IOException("La prueba requiere una carpeta temporal.");
          Data.Home=Path.GetFullPath(args[1]);SafePaths.SandboxRoot=Data.Home;var config=Coordinator.Ensure(Int32.Parse(args[2]));Data.Save("auto-result.json",new {paired=config!=null,server=config==null?"":Data.S(config,"server"),serverId=config==null?"":Data.S(config,"serverId")},false);return 0;
        }
        if(command=="--sandbox-teacher-action"){
          if(args.Length<3||!Path.GetFullPath(args[1]).StartsWith(Path.GetTempPath(),StringComparison.OrdinalIgnoreCase))throw new IOException("La prueba requiere una carpeta temporal.");
          Data.Home=Path.GetFullPath(args[1]);SafePaths.SandboxRoot=Data.Home;
          if(args[2]=="confirm"&&args.Length==4)Coordinator.ConfirmTeacher(args[3]);
          else if(args[2]=="select"&&args.Length==4)Coordinator.SelectTeacher(args[3]);
          else if(args[2]=="change")Coordinator.BeginChange();
          else if(args[2]=="cancel")Coordinator.CancelChange();
          else if(args[2]=="rediscover"&&args.Length==4)Coordinator.Rediscover(Data.Load("settings.dat",true),Int32.Parse(args[3]));
          else throw new IOException("Acción de prueba no válida.");
          var config=Data.Load("settings.dat",true);Data.Save("action-result.json",new {server=config==null?"":Data.S(config,"server"),serverId=config==null?"":Data.S(config,"serverId"),changing=Coordinator.IsChanging()},false);return 0;
        }
        if(command=="--sandbox-user-tick"||command=="--sandbox-tick"){
          if(args.Length!=3||!Path.GetFullPath(args[1]).StartsWith(Path.GetTempPath(),StringComparison.OrdinalIgnoreCase))throw new IOException("La prueba requiere una carpeta temporal.");
          if(!args[2].StartsWith(@"Software\ARMI\StudentAgentTest\",StringComparison.Ordinal))throw new IOException("La prueba requiere una clave de registro aislada.");
          Data.Home=Path.GetFullPath(args[1]);SafePaths.SandboxRoot=Data.Home;Directory.CreateDirectory(Path.Combine(Data.Home,"receipts"));
          string fixture=Path.Combine(Data.Home,"sandbox-settings.json");if(File.Exists(fixture)){Data.Save("settings.dat",Data.Load("sandbox-settings.json",false),true);File.Delete(fixture);}
          if(command=="--sandbox-user-tick")UserFolders.Tick(Data.Load("settings.dat",true));else new Agent(new WebPolicies(Microsoft.Win32.Registry.CurrentUser,new[]{args[2]},"sandbox-policies.json")).Tick();return 0;
        }
        if(!Admin()){var info=new ProcessStartInfo(Application.ExecutablePath,String.Join(" ",args)){UseShellExecute=true,Verb="runas"};Process.Start(info);return 0;}
        if(command=="--stop-service"){StopService();CloseClients();return 0;}
        if(command=="--install-service"){
          Data.Init();BrowserHost(false);bool exists=false;foreach(var c in ServiceController.GetServices())using(c)if(c.ServiceName==Service)exists=true;
          if(exists)StopService();
          string binary="\\\""+Application.ExecutablePath+"\\\" --service";
          Sc((exists?"config ":"create ")+Service+" binPath= \""+binary+"\" start= auto obj= LocalSystem DisplayName= \"ARMI Estudiante\"");
          Sc("description "+Service+" \"Agente de aula ARMI: reglas web y entrega de recursos autorizados por el docente.\"");
          Sc("failure "+Service+" reset= 86400 actions= restart/15000/restart/30000/restart/60000");StartService();return 0;
        }
        if(command=="--uninstall-service"){
          StopService();CloseClients();ReportUninstall();BrowserHost(true);new WebPolicies().Apply(new List<string>(),new Uri("http://localhost"));Sc("delete "+Service);return 0;
        }
        throw new ArgumentException("Opción no reconocida.");
      }catch(Exception e){Data.Log(e.ToString());if(args.Length==0||args[0]=="--configure")MessageBox.Show(e.Message,"ARMI Estudiante",MessageBoxButtons.OK,MessageBoxIcon.Error);else File.WriteAllText(Path.Combine(Path.GetTempPath(),"armi-student-last-error.txt"),e.ToString());return 1;}
    }
    static void ServicePointSetup(){System.Net.ServicePointManager.SecurityProtocol=System.Net.SecurityProtocolType.Tls12;}
  }
}
