using System;
using System.IO;
using System.Drawing;
using System.Windows.Forms;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading.Tasks;
using System.Runtime.InteropServices;

namespace Armi.Student {
  public static class UserFolders {
    public static string Root(string destination,string classroom){
      if(destination=="classroom")return SafePaths.Root(classroom);
      if(SafePaths.SandboxRoot!=null)return Path.Combine(SafePaths.SandboxRoot,"user-"+destination);
      switch(destination){case "pictures":return Environment.GetFolderPath(Environment.SpecialFolder.MyPictures);case "documents":return Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);case "desktop":return Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);case "downloads":
        IntPtr value;int result=SHGetKnownFolderPath(new Guid("374DE290-123F-4565-9164-39C4925E467B"),0,IntPtr.Zero,out value);if(result!=0)Marshal.ThrowExceptionForHR(result);try{return Marshal.PtrToStringUni(value);}finally{Marshal.FreeCoTaskMem(value);}
      default:throw new IOException("Carpeta personal no admitida.");}
    }
    [DllImport("shell32.dll")]static extern int SHGetKnownFolderPath([MarshalAs(UnmanagedType.LPStruct)]Guid folder,uint flags,IntPtr token,out IntPtr path);
    public static string Inside(string root,string relative){
      if(String.IsNullOrEmpty(root)||!Path.IsPathRooted(root)||root.StartsWith(@"\\"))throw new IOException("La carpeta personal no es una ruta local disponible.");
      root=Path.GetFullPath(root).TrimEnd('\\');SafePaths.NoLinks(root);
      if(relative=="")return root;
      return SafePaths.RelativeInside(root,relative);
    }
    public static string Apply(Dictionary<string,object> job,Dictionary<string,object> policy,Dictionary<string,object> config,Api api){
      string type=Data.S(job,"type"),id=Data.S(job,"id"),destination=Data.S(job,"destination");Guid guid;if(!Guid.TryParse(id,out guid))throw new IOException("Identificador no válido.");
      if(!Agent.Allowed(policy,config,type=="receive-file"?"files":"folders"))throw new IOException("Acción no autorizada por el docente.");
      if(destination=="classroom"&&type!="open-folder")throw new IOException("Se requiere el servicio para modificar la carpeta del aula.");
      string root=Root(destination,Data.S(config,"rootPath")),relative=Data.S(job,"relativePath"),target=Inside(root,relative);
      if(relative==""&&type!="open-folder")throw new IOException("No se puede modificar la raíz de una carpeta personal.");
      string hash=Data.Hash(System.Text.Encoding.UTF8.GetBytes(Data.Json.Serialize(job))),name="receipts/"+id+".json";var receipt=Data.Load(name,false);
      if(receipt!=null){if(Data.S(receipt,"hash")!=hash)throw new IOException("Identificador de orden reutilizado.");if(Data.S(receipt,"state")=="success")return Data.S(receipt,"message");}
      Data.Save(name,new {hash=hash,state="started"},false);string message;
      if(type=="create-folder"){Directory.CreateDirectory(target);SafePaths.NoLinks(target);message="Carpeta creada en la sesión del estudiante.";}
      else if(type=="rename-folder"){
        string renamed=Inside(root,Data.S(job,"newRelativePath"));SafePaths.NoLinks(target);
        if(!Directory.Exists(target)&&Directory.Exists(renamed)&&receipt!=null&&Data.S(receipt,"state")=="renaming"&&Data.S(receipt,"target")==renamed)message="Carpeta renombrada.";
        else {if(!Directory.Exists(target)||Directory.Exists(renamed)||File.Exists(renamed))throw new IOException("No se puede renombrar: revisa la carpeta de origen y el nombre de destino.");
          Data.Save(name,new {hash=hash,state="renaming",target=renamed},false);Directory.Move(target,renamed);message="Carpeta renombrada.";}
      }
      else if(type=="open-folder"){
        if(!Directory.Exists(target))throw new IOException("La carpeta todavía no existe.");SafePaths.NoLinks(target);
        if(SafePaths.SandboxRoot==null)Process.Start(new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows),"explorer.exe"),"\""+target+"\""){UseShellExecute=false});message="Carpeta abierta en la pantalla del estudiante.";
      }
      else if(type=="receive-file"){
        var file=Data.D(job["file"]);long size=Convert.ToInt64(file["size"]);string expected=Data.S(file,"sha256");
        if(size<0||size>50*1024*1024||!System.Text.RegularExpressions.Regex.IsMatch(expected,"^[a-f0-9]{64}$"))throw new IOException("Archivo no válido.");
        if(File.Exists(target)){if(Data.FileHash(target)!=expected)throw new IOException("Ya existe un archivo diferente. Se conservó.");message="El archivo ya está disponible.";}
        else {Directory.CreateDirectory(Path.GetDirectoryName(target));SafePaths.NoLinks(Path.GetDirectoryName(target));string temporary=Path.Combine(Path.GetDirectoryName(target),".armi-"+id+".download");
          try{if(File.Exists(temporary))File.Delete(temporary);api.Download(Data.S(file,"url"),temporary,size);if(Data.FileHash(temporary)!=expected)throw new IOException("La huella no coincide.");Inside(root,relative);File.Move(temporary,target);message="Archivo recibido en la carpeta del estudiante.";}
          finally{if(File.Exists(temporary))File.Delete(temporary);}
        }
      }else throw new IOException("Acción de sesión no admitida.");
      Data.Save(name,new {hash=hash,state="success",message=message},false);return message;
    }
    public static void Tick(Dictionary<string,object> config){if(SafePaths.SandboxRoot==null&&Process.GetCurrentProcess().SessionId!=WindowsSession.ActiveSession())return;var api=new Api(Data.S(config,"server"),Data.S(config,"token"));if(Data.S(config,"serverId")!="")Discovery.VerifyEndpoint(api.Origin,Data.S(config,"serverId"),Data.S(config,"modulus"));var pulse=Data.D(api.Call("/api/student-agent/session/heartbeat",new {}));var policy=Data.D(pulse["policy"]);
      foreach(var value in Data.A(api.Call("/api/student-agent/jobs",null))){if(SafePaths.SandboxRoot==null&&Process.GetCurrentProcess().SessionId!=WindowsSession.ActiveSession())return;var job=Data.D(value);string state="success",message;
        try{message=Apply(job,policy,config,api);}catch(System.Net.WebException){throw;}catch(ApiException e){if(e.Status==401||e.Status>=500)throw;state="error";message=e.Message;}catch(Exception e){state="error";message=e.Message;}
        api.Call("/api/student-agent/jobs/"+Data.S(job,"id")+"/result",new {state=state,message=message});
      }
    }
  }
}
