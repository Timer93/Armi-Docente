using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Net.NetworkInformation;
using System.Security.Cryptography;
using System.Collections.Generic;
using System.Text;

namespace Armi.Student {
  public static class Discovery {
    public const int Port=50321;
    public static string Nonce(){var bytes=new byte[16];using(var rng=RandomNumberGenerator.Create())rng.GetBytes(bytes);return BitConverter.ToString(bytes).Replace("-","").ToLowerInvariant();}
    public static string Secret(){var bytes=new byte[32];using(var rng=RandomNumberGenerator.Create())rng.GetBytes(bytes);return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+','-').Replace('/','_');}
    public static Dictionary<string,object> VerifySigned(Dictionary<string,object> signed,string modulus){
      string payload=Data.S(signed,"payload"),key=Data.S(signed,"modulus");if(modulus!=""&&modulus!=key)throw new IOException("La identidad del docente cambió.");
      if(Data.S(signed,"exponent")!="AQAB")throw new IOException("La clave de descubrimiento no es compatible.");
      using(var rsa=new RSACryptoServiceProvider()){rsa.PersistKeyInCsp=false;rsa.ImportParameters(new RSAParameters{Modulus=Convert.FromBase64String(key),Exponent=Convert.FromBase64String(Data.S(signed,"exponent"))});
        if(!rsa.VerifyData(Encoding.UTF8.GetBytes(payload),CryptoConfig.MapNameToOID("SHA256"),Convert.FromBase64String(Data.S(signed,"signature"))))throw new IOException("No se pudo verificar al docente.");}
      var result=Data.Json.Deserialize<Dictionary<string,object>>(payload);result["modulus"]=key;return result;
    }
    public static Dictionary<string,object> Verify(Dictionary<string,object> signed,string nonce,string modulus){
      var result=VerifySigned(signed,modulus);if(Data.S(result,"nonce")!=nonce||Convert.ToInt32(result["protocol"])!=2)throw new IOException("Respuesta de descubrimiento no válida.");
      int port=Convert.ToInt32(result["port"]);if(port<1||port>65535)throw new IOException("Puerto no válido.");return result;
    }
    public static List<Dictionary<string,object>> Find(int port=Port,bool loopbackOnly=false){
      string nonce=Nonce();var found=new List<Dictionary<string,object>>();byte[] query=Encoding.UTF8.GetBytes(Data.Json.Serialize(new {type="armi-student-discover",nonce=nonce}));
      using(var udp=new UdpClient(0)){udp.EnableBroadcast=true;udp.Client.ReceiveTimeout=250;
        var addresses=new HashSet<string>{"127.0.0.1"};if(!loopbackOnly)addresses.Add("255.255.255.255");
        if(!loopbackOnly)foreach(var adapter in NetworkInterface.GetAllNetworkInterfaces())if(adapter.OperationalStatus==OperationalStatus.Up)foreach(var ip in adapter.GetIPProperties().UnicastAddresses)if(ip.Address.AddressFamily==AddressFamily.InterNetwork&&ip.IPv4Mask!=null){var a=ip.Address.GetAddressBytes();var m=ip.IPv4Mask.GetAddressBytes();for(int i=0;i<4;i++)a[i]=(byte)(a[i]|~m[i]);addresses.Add(new IPAddress(a).ToString());}
        foreach(string address in addresses)try{udp.Send(query,query.Length,new IPEndPoint(IPAddress.Parse(address),port));}catch(SocketException){}
        DateTime until=DateTime.UtcNow.AddSeconds(2);while(DateTime.UtcNow<until)try{var remote=new IPEndPoint(IPAddress.Any,0);byte[] bytes=udp.Receive(ref remote);if(bytes.Length>8192)continue;
          var descriptor=Verify(Data.Json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(bytes)),nonce,"");descriptor["origin"]="http://"+remote.Address+":"+Convert.ToInt32(descriptor["port"]);
          if(!found.Exists(d=>Data.S(d,"serverId")==Data.S(descriptor,"serverId")))found.Add(descriptor);
        }catch(SocketException){}catch(Exception){}
      }return found;
    }
    public static void VerifyEndpoint(string origin,string serverId,string modulus,int timeout=15000){string nonce=Nonce();var reply=Data.D(new Api(origin,"",timeout).Call("/api/student-agent/identity?nonce="+nonce,null));var identity=Verify(reply,nonce,modulus);if(Data.S(identity,"serverId")!=serverId)throw new IOException("Esta dirección pertenece a otro docente.");}
  }
  public static class Coordinator {
    public static readonly object Gate=new object();
    public static void State(string state,string text,object candidates,string verificationCode="",string teacherName=""){Data.Save("setup-state.json",new {state=state,message=text,candidates=candidates,verificationCode=verificationCode,teacherName=teacherName,updatedAt=DateTime.UtcNow.ToString("o")},false);}
    static Dictionary<string,object> Identity(Dictionary<string,object> config){
      var identity=Data.Load("installation.dat",true);if(identity==null){identity=new Dictionary<string,object>{{"id",config!=null&&Data.S(config,"installationId")!=""?Data.S(config,"installationId"):Guid.NewGuid().ToString()},{"secret",Discovery.Secret()}};Data.Save("installation.dat",identity,true);}return identity;
    }
    static string SecretFor(Dictionary<string,object> identity,Dictionary<string,object> teacher){
      var secrets=identity.ContainsKey("teacherSecrets")?Data.D(identity["teacherSecrets"]):new Dictionary<string,object>();
      string key=Data.Hash(Encoding.UTF8.GetBytes(Data.S(teacher,"serverId")+"\n"+Data.S(teacher,"modulus")));
      if(!secrets.ContainsKey(key)){secrets[key]=secrets.Count==0&&Data.S(identity,"secret")!=""?Data.S(identity,"secret"):Discovery.Secret();identity["teacherSecrets"]=secrets;Data.Save("installation.dat",identity,true);}return Data.S(secrets,key);
    }
    public static string Verification(string serverId,string modulus,string installationId,string secret){return Data.Hash(Encoding.UTF8.GetBytes(String.Join("\n",new[]{serverId,modulus,installationId,secret}))).Substring(0,8).ToUpperInvariant();}
    public static bool IsKnown(Dictionary<string,object> teacher){var known=Data.Load("known-teachers.dat",true);string id=Data.S(teacher,"serverId");return known!=null&&known.ContainsKey(id)&&Data.S(Data.D(known[id]),"modulus")==Data.S(teacher,"modulus");}
    static void Remember(Dictionary<string,object> teacher){string id=Data.S(teacher,"serverId"),key=Data.S(teacher,"modulus");if(id==""||key=="")return;var known=Data.Load("known-teachers.dat",true)??new Dictionary<string,object>();known[id]=new {modulus=key,teacherName=Data.S(teacher,"teacherName")};Data.Save("known-teachers.dat",known,true);}
    public static bool IsChanging(){lock(Gate){var identity=Data.Load("installation.dat",true);return identity!=null&&Data.B(identity,"changing");}}
    public static void BeginChange(){lock(Gate){var config=Data.Load("settings.dat",true);if(config!=null&&Data.S(config,"token")!="")Remember(config);var identity=Identity(config);identity["changing"]=true;identity["selectedTeacher"]="";identity["selectedModulus"]="";identity["confirmedTeacher"]="";identity["confirmedModulus"]="";Data.Save("installation.dat",identity,true);State("searching","Buscando docentes. La vinculación anterior se conserva hasta completar el cambio.",new object[0]);}}
    public static void CancelChange(){lock(Gate){var config=Data.Load("settings.dat",true);if(config==null||Data.S(config,"token")=="")throw new IOException("No hay una vinculación anterior para recuperar.");var identity=Identity(config);identity["changing"]=false;identity["selectedTeacher"]=Data.S(config,"serverId");identity["selectedModulus"]=Data.S(config,"modulus");Data.Save("installation.dat",identity,true);State("connected","Cambio cancelado. Se conserva el docente anterior.",new object[0]);}}
    public static void SelectTeacher(string serverId){lock(Gate){
      var setup=Data.Load("setup-state.json",false);Dictionary<string,object> teacher=null;if(setup!=null)foreach(var item in Data.A(setup["candidates"])){var candidate=Data.D(item);if(Data.S(candidate,"serverId")==serverId)teacher=candidate;}
      if(teacher==null)throw new IOException("El docente ya no está disponible. Vuelve a buscar.");
      var config=Data.Load("settings.dat",true);var identity=Identity(config);if(config!=null&&Data.S(config,"token")!=""&&!Data.B(identity,"changing"))throw new IOException("Usa Cambiar de docente para iniciar otra vinculación.");
      if(Data.S(identity,"selectedTeacher")!=serverId||Data.S(identity,"selectedModulus")!=Data.S(teacher,"modulus")){identity["confirmedTeacher"]="";identity["confirmedModulus"]="";}
      identity["selectedTeacher"]=serverId;identity["selectedModulus"]=Data.S(teacher,"modulus");Data.Save("installation.dat",identity,true);
    }}
    public static void ConfirmTeacher(string verificationCode){lock(Gate){var setup=Data.Load("setup-state.json",false);var identity=Identity(Data.Load("settings.dat",true));
      if(setup==null||Data.S(setup,"state")!="confirm"||verificationCode.Replace("-","").ToUpperInvariant()!=Data.S(setup,"verificationCode"))throw new IOException("El código cambió. Comprueba de nuevo ambos equipos.");
      identity["confirmedTeacher"]=Data.S(identity,"selectedTeacher");identity["confirmedModulus"]=Data.S(identity,"selectedModulus");Data.Save("installation.dat",identity,true);
    }}
    public static Dictionary<string,object> Ensure(int discoveryPort=Discovery.Port){lock(Gate){
      var config=Data.Load("settings.dat",true);var identity=Identity(config);if(config!=null&&Data.S(config,"token")!=""&&!Data.B(identity,"changing"))return config;
      var teachers=Discovery.Find(discoveryPort,SafePaths.SandboxRoot!=null);string selected=Data.S(identity,"selectedTeacher"),modulus=Data.S(identity,"selectedModulus");
      var teacher=teachers.Find(t=>Data.S(t,"serverId")==selected&&(modulus==""||Data.S(t,"modulus")==modulus));
      if(teacher==null&&selected==""&&teachers.Count==1){teacher=teachers[0];identity["selectedTeacher"]=Data.S(teacher,"serverId");identity["selectedModulus"]=Data.S(teacher,"modulus");Data.Save("installation.dat",identity,true);}
      if(teacher==null){State(teachers.Count>0?"choose":"searching",teachers.Count>0?"Selecciona el docente con quien vas a trabajar.":"Buscando ARMI Docente en la red local…",teachers);return null;}
      string id=Data.S(teacher,"serverId"),key=Data.S(teacher,"modulus"),name=Data.S(teacher,"teacherName"),origin=Data.S(teacher,"origin"),secret=SecretFor(identity,teacher);
      Discovery.VerifyEndpoint(origin,id,key);
      string verification=Verification(id,key,Data.S(identity,"id"),secret);
      string approvalNonce=Discovery.Nonce();
      var request=Data.D(new Api(origin,"").Call("/api/student-agent/auto-enroll",new {pairingProtocol=4,nonce=approvalNonce,installationId=Data.S(identity,"id"),secret=secret,machineName=Environment.MachineName}));
      if((Data.S(request,"pairingProtocol")!="3"&&Data.S(request,"pairingProtocol")!="4")||Data.S(request,"verificationCode")!=verification){State("update-required","Actualiza ARMI Docente para mostrar y verificar el código de vinculación.",teachers,"",name);return null;}
      string state=Data.S(request,"state");if(state!="approved"){State(state=="rejected"?"rejected":"waiting",state=="rejected"?"El docente rechazó esta solicitud.":"Esperando aprobación de "+name+". Comprueba el código en ambos equipos.",teachers,verification,name);return null;}
      bool approvedAutomatically=false;
      if(Data.S(request,"pairingProtocol")=="4"){
        var proof=Discovery.VerifySigned(Data.D(request["approval"]),key);
        if(Data.S(proof,"purpose")!="armi-enrollment-approval"||Data.S(proof,"serverId")!=id||Data.S(proof,"nonce")!=approvalNonce||Data.S(proof,"installationId")!=Data.S(identity,"id")||Data.S(proof,"verificationCode")!=verification||Data.S(proof,"code")!=Data.S(request,"code"))throw new IOException("La aprobación del docente no corresponde a este equipo.");
        approvedAutomatically=true;
      }
      if(!approvedAutomatically&&!IsKnown(teacher)&&(Data.S(identity,"confirmedTeacher")!=id||Data.S(identity,"confirmedModulus")!=key)){State("confirm","El docente aprobó este equipo. Confirma que ambos muestran el mismo código.",teachers,verification,name);return null;}
      string root=@"C:\ARMI-Aula";if(config!=null&&Data.S(config,"rootPath")!="")root=Data.S(config,"rootPath");
      if(config==null&&Directory.Exists(root)&&Directory.GetFileSystemEntries(root).Length>0)root+="-"+Data.S(identity,"id").Substring(0,8);
      if(SafePaths.SandboxRoot!=null){root=Path.Combine(Data.Home,"classroom");Directory.CreateDirectory(root);File.WriteAllText(Path.Combine(root,".armi-root"),"Sandbox");}else root=SafePaths.Prepare(root,config==null?"":Data.S(config,"rootPath"));
      var paired=Data.D(new Api(origin,"").Call("/api/student-agent/pair",new {code=Data.S(request,"code"),installationId=Data.S(identity,"id"),machineName=Environment.MachineName}));
      object capabilities=config!=null&&config.ContainsKey("capabilities")?config["capabilities"]:new Dictionary<string,object>{{"navigation",true},{"folders",true},{"files",true}};
      config=new Dictionary<string,object>{{"server",origin},{"token",Data.S(paired,"token")},{"enrollment",Data.S(paired,"enrollment")},{"installationId",Data.S(identity,"id")},{"serverId",id},{"teacherName",name},{"modulus",key},{"rootPath",root},{"capabilities",capabilities}};
      Data.Save("settings.dat",config,true);Data.Save("browser-policy.json",paired["policy"],false);
      Remember(config);
      identity["changing"]=false;Data.Save("installation.dat",identity,true);
      State("connected","Autoconfiguración completada. Equipo vinculado con "+name+".",new object[0]);return config;
    }}
    public static void Rediscover(Dictionary<string,object> config,int discoveryPort=Discovery.Port){lock(Gate){
      string serverId=Data.S(config,"serverId"),modulus=Data.S(config,"modulus");if(serverId==""||modulus==""){State("manual","Vinculación anterior: vuelve a vincular para activar la detección automática.",new object[0]);return;}
      foreach(var teacher in Discovery.Find(discoveryPort,SafePaths.SandboxRoot!=null))if(Data.S(teacher,"serverId")==serverId&&Data.S(teacher,"modulus")==modulus){string origin=Data.S(teacher,"origin");Discovery.VerifyEndpoint(origin,serverId,modulus);config["server"]=origin;Data.Save("settings.dat",config,true);return;}
      State("offline","Docente sin conexión. Reintentando automáticamente…",new object[0]);
    }}
  }
}
