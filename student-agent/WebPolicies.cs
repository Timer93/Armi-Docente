using System;
using System.IO;
using System.Collections.Generic;
using Microsoft.Win32;

namespace Armi.Student {
  public sealed class WebPolicies {
    readonly RegistryKey hive;readonly string[] roots;readonly string manifest;
    public WebPolicies():this(Registry.LocalMachine,new[]{@"SOFTWARE\Policies\Google\Chrome",@"SOFTWARE\Policies\Microsoft\Edge"},"web-policies.json"){}
    public WebPolicies(RegistryKey hive,string[] roots,string manifest){this.hive=hive;this.roots=roots;this.manifest=manifest;}
    List<Dictionary<string,object>> Owned(){var data=Data.Load(manifest,false);var result=new List<Dictionary<string,object>>();if(data!=null)foreach(var v in Data.A(data["entries"]))result.Add(Data.D(v));return result;}
    static bool Match(Dictionary<string,object> entry,string key,string name,string value){return Data.S(entry,"key")==key&&Data.S(entry,"name")==name&&Data.S(entry,"value")==value;}
    bool IsOwned(List<Dictionary<string,object>> entries,string key,string name,string value){return entries.Exists(e=>Match(e,key,name,value));}
    Dictionary<string,object> Entry(string key,string name,string value){return new Dictionary<string,object>{{"key",key},{"name",name},{"value",value}};}
    public void Apply(List<string> domains,Uri teacher) {
      if(domains.Count>1000)throw new IOException("Chrome y Edge admiten hasta 1000 dominios por lista. Reduce las reglas del equipo.");
      foreach(string domain in domains)if(!System.Text.RegularExpressions.Regex.IsMatch(domain,@"^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$"))throw new IOException("La política contiene un dominio no válido.");
      var prior=Owned();var desired=new List<Dictionary<string,object>>();var livePrior=new List<Dictionary<string,object>>();
      // Preflight every browser before changing any policy. Preserve entries owned by others.
      foreach(string root in roots)foreach(string list in new[]{"URLBlocklist","URLAllowlist"}) {
        string key=root+"\\"+list;var other=new Dictionary<string,string>();
        using(var registry=hive.OpenSubKey(key))if(registry!=null)foreach(string name in registry.GetValueNames()) {
          string value=Convert.ToString(registry.GetValue(name));
          if(IsOwned(prior,key,name,value))livePrior.Add(Entry(key,name,value));else other[name]=value;
        }
        var values=list=="URLBlocklist"?domains:(domains.Count>0?new List<string>{teacher.GetLeftPart(UriPartial.Authority)+"/*"}:new List<string>());
        foreach(string value in values) {
          if(other.ContainsValue(value))continue;
          int n=1;while(n<=1000&&(other.ContainsKey(n.ToString())||desired.Exists(e=>Data.S(e,"key")==key&&Data.S(e,"name")==n.ToString())))n++;
          if(n>1000)throw new IOException("No hay espacio en las políticas del navegador; se conservaron las reglas anteriores.");
          desired.Add(Entry(key,n.ToString(),value));
        }
        if(other.Count+values.Count>1000)throw new IOException("La lista del navegador supera 1000 entradas, incluidas las reglas de la institución.");
      }
      if(prior.Count==desired.Count&&desired.TrueForAll(e=>livePrior.Exists(p=>Match(p,Data.S(e,"key"),Data.S(e,"name"),Data.S(e,"value")))))return;
      var journal=new List<Dictionary<string,object>>(livePrior);
      foreach(var entry in desired)if(!journal.Exists(p=>Match(p,Data.S(entry,"key"),Data.S(entry,"name"),Data.S(entry,"value"))))journal.Add(entry);
      Data.Save(manifest,new {entries=journal},false);
      try {
        foreach(var entry in livePrior)using(var registry=hive.OpenSubKey(Data.S(entry,"key"),true))if(registry!=null&&Convert.ToString(registry.GetValue(Data.S(entry,"name")))==Data.S(entry,"value"))registry.DeleteValue(Data.S(entry,"name"),false);
        foreach(var entry in desired)using(var registry=hive.CreateSubKey(Data.S(entry,"key"))) {
          object current=registry.GetValue(Data.S(entry,"name"));if(current!=null&&Convert.ToString(current)!=Data.S(entry,"value"))throw new IOException("Otra política cambió mientras se aplicaban las reglas.");
          registry.SetValue(Data.S(entry,"name"),Data.S(entry,"value"),RegistryValueKind.String);
        }
        Data.Save(manifest,new {entries=desired},false);
      }catch {
        // Best-effort rollback; the durable journal also permits recovery after power loss.
        foreach(var entry in desired)using(var registry=hive.OpenSubKey(Data.S(entry,"key"),true))if(registry!=null&&Convert.ToString(registry.GetValue(Data.S(entry,"name")))==Data.S(entry,"value"))registry.DeleteValue(Data.S(entry,"name"),false);
        foreach(var entry in livePrior)using(var registry=hive.CreateSubKey(Data.S(entry,"key")))if(registry.GetValue(Data.S(entry,"name"))==null)registry.SetValue(Data.S(entry,"name"),Data.S(entry,"value"),RegistryValueKind.String);
        throw;
      }
    }
  }
}
