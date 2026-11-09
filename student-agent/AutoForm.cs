using System;
using System.IO;
using System.Drawing;
using System.Windows.Forms;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Diagnostics;

namespace Armi.Student {
  sealed class AutoForm:Form {
    readonly NotifyIcon tray;
    readonly Label status=new Label(),detail=new Label(),verification=new Label();
    readonly ComboBox teachers=new ComboBox();
    readonly Button select=new Button(),confirm=new Button(),change=new Button(),cancel=new Button();
    readonly Timer timer=new Timer();
    readonly List<string> teacherIds=new List<string>();
    Dictionary<string,object> session;
    bool busy,actionBusy,successShown,hideAfterSuccess;
    string currentVerification="",observedEnrollment="",lastPromptVerification="";
    DateTime successAt;

    public AutoForm(bool preview=false){
      Text="ARMI Estudiante "+Program.Version+" · Vinculación";ClientSize=new Size(620,400);FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;ShowInTaskbar=false;StartPosition=FormStartPosition.CenterScreen;Font=new Font("Segoe UI",10);Icon=Icon.ExtractAssociatedIcon(Application.ExecutablePath);
      Controls.Add(new PictureBox{Image=Icon.ToBitmap(),SizeMode=PictureBoxSizeMode.Zoom,Left=25,Top=24,Width=52,Height=52});
      Controls.Add(new Label{Text="ARMI Estudiante",Font=new Font("Segoe UI",19,FontStyle.Bold),Left=92,Top=24,Width=500,Height=39});
      Controls.Add(new Label{Text="PC: "+Environment.MachineName+" · Usuario: "+Environment.UserName,Left=92,Top=66,Width=500,Height=28});
      status.SetBounds(25,112,570,54);status.Text="Buscando docentes en la red local…";Controls.Add(status);
      teachers.SetBounds(25,174,405,30);teachers.DropDownStyle=ComboBoxStyle.DropDownList;teachers.Visible=false;Controls.Add(teachers);
      select.SetBounds(444,172,150,34);select.Text="Usar docente";select.Visible=false;select.Click+=async(s,e)=>{int index=teachers.SelectedIndex;if(index>=0)await Command(new {type="select-teacher",serverId=teacherIds[index]},false);};Controls.Add(select);
      detail.SetBounds(25,216,570,48);detail.Text="No necesitas escribir una IP.\nEl docente aprueba el equipo y verificas el código una sola vez.";Controls.Add(detail);
      verification.SetBounds(25,269,570,35);verification.Font=new Font("Consolas",21,FontStyle.Bold);verification.ForeColor=Color.FromArgb(0,88,150);Controls.Add(verification);
      change.SetBounds(25,321,190,34);change.Text="Cambiar de docente";change.Click+=async(s,e)=>await Command(new {type="change-teacher"},true);Controls.Add(change);
      confirm.SetBounds(300,321,295,34);confirm.Text="El código coincide · Vincular";confirm.Visible=false;confirm.Click+=async(s,e)=>await Command(new {type="confirm-teacher",verificationCode=currentVerification},false);Controls.Add(confirm);
      cancel.SetBounds(25,362,275,29);cancel.Text="Cancelar y conservar docente anterior";cancel.Visible=false;cancel.Click+=async(s,e)=>await Command(new {type="cancel-teacher-change"},false);Controls.Add(cancel);
      var menu=new ContextMenuStrip();menu.Items.Add("Mostrar estado",null,(s,e)=>Open());menu.Items.Add("Cambiar de docente…",null,async(s,e)=>await Command(new {type="change-teacher"},true));menu.Items.Add("Instrucciones",null,(s,e)=>Process.Start(new ProcessStartInfo(Path.Combine(Application.StartupPath,"LEEME.html")){UseShellExecute=true}));
      tray=new NotifyIcon{Icon=Icon,Text="ARMI Estudiante · Configurando",Visible=!preview,ContextMenuStrip=menu};tray.DoubleClick+=(s,e)=>Open();
      FormClosing+=(s,e)=>{if(e.CloseReason==CloseReason.UserClosing){e.Cancel=true;Hide();}};Resize+=(s,e)=>{if(WindowState==FormWindowState.Minimized)Hide();};
      successShown=File.Exists(Path.Combine(Data.Home,"setup-completed.json"));
      timer.Interval=3000;timer.Tick+=async(s,e)=>await Pulse();if(!preview){timer.Start();Shown+=async(s,e)=>{if(successShown)Hide();await Pulse();};}
    }
    void Open(){Show();WindowState=FormWindowState.Normal;Activate();}
    async Task Command(object command,bool reset){
      if(actionBusy)return;actionBusy=true;select.Enabled=false;confirm.Enabled=false;change.Enabled=false;cancel.Enabled=false;
      try {await Task.Run(()=>SessionBridge.Call(command));session=null;if(reset){successShown=false;hideAfterSuccess=false;Open();}status.Text="Actualizando vinculación…";}
      catch(Exception e){status.Text=e.Message;}
      finally{actionBusy=false;select.Enabled=true;confirm.Enabled=true;change.Enabled=true;cancel.Enabled=true;}
    }
    async Task Pulse(){
      if(busy||actionBusy)return;busy=true;
      try {
        var snapshot=await Task.Run(()=>SessionBridge.Call(new {type="status"}));
        var setup=snapshot.ContainsKey("setup")&&snapshot["setup"]!=null?Data.D(snapshot["setup"]):null;
        string state=setup==null?"searching":Data.S(setup,"state");status.Text=setup==null?"Buscando docentes en la red local…":Data.S(setup,"message");
        string enrollment=Data.S(snapshot,"enrollment");if(observedEnrollment!=""&&observedEnrollment!=enrollment){session=null;successShown=false;}observedEnrollment=enrollment;
        bool connected=(state=="connected"||state=="warning")&&!Data.B(snapshot,"changing");
        cancel.Visible=Data.B(snapshot,"changing")&&Data.B(snapshot,"paired");
        confirm.Visible=state=="confirm";currentVerification=setup==null?"":Data.S(setup,"verificationCode");
        verification.Text=currentVerification.Length==8?currentVerification.Substring(0,4)+"-"+currentVerification.Substring(4):"";
        if(state=="confirm"&&currentVerification!=""&&lastPromptVerification!=currentVerification){lastPromptVerification=currentVerification;successShown=false;hideAfterSuccess=false;Open();tray.ShowBalloonTip(5000,"Falta confirmar la vinculación","El docente aprobó esta PC. Compara el código y pulsa El código coincide · Vincular.",ToolTipIcon.Info);}
        string selected=teachers.SelectedIndex>=0&&teachers.SelectedIndex<teacherIds.Count?teacherIds[teachers.SelectedIndex]:"";
        var candidates=new List<Dictionary<string,object>>();if(setup!=null&&setup.ContainsKey("candidates"))foreach(var item in Data.A(setup["candidates"]))candidates.Add(Data.D(item));
        teachers.Visible=!connected&&candidates.Count>1||state=="choose";select.Visible=teachers.Visible;
        if(teachers.Visible&&!teachers.DroppedDown){teachers.Items.Clear();teacherIds.Clear();foreach(var teacher in candidates){teachers.Items.Add(Data.S(teacher,"teacherName")+" · "+Data.S(teacher,"origin"));teacherIds.Add(Data.S(teacher,"serverId"));}int index=teacherIds.IndexOf(selected);if(teachers.Items.Count>0)teachers.SelectedIndex=index>=0?index:0;}
        tray.Text=connected?"ARMI Estudiante · Conectado":"ARMI Estudiante · "+(state=="waiting"||state=="confirm"?"Vinculando":"Buscando docente");
        if(connected){
          status.ForeColor=state=="warning"?Color.DarkOrange:Color.DarkGreen;
          detail.Text=state=="warning"?"Las carpetas y archivos siguen disponibles. Revisa el aviso web en ARMI.":"Vinculación completada. El agente seguirá activo junto al reloj.";
          if(!successShown&&state=="connected"){successShown=true;hideAfterSuccess=true;successAt=DateTime.UtcNow;Data.Save("setup-completed.json",new {success=true},false);tray.ShowBalloonTip(2500,"ARMI Estudiante","Equipo vinculado. El agente sigue en segundo plano.",ToolTipIcon.Info);}
          if(hideAfterSuccess&&DateTime.UtcNow-successAt>TimeSpan.FromSeconds(3)){Hide();hideAfterSuccess=false;}
          if(session==null||Data.S(session,"server")!=Data.S(snapshot,"server")||Data.S(session,"enrollment")!=enrollment)session=await Task.Run(()=>SessionBridge.Call(new {type="session"}));
          try{await Task.Run(()=>UserFolders.Tick(session));}catch(ApiException e){if(e.Status==401)session=null;throw;}
        }else{
          status.ForeColor=Color.DimGray;session=null;
          detail.Text=currentVerification!=""?"Docente: "+Data.S(setup,"teacherName")+"\nCompara este código con el que muestra ARMI en el equipo del docente.":"Elige un docente disponible. Puedes cambiar de colegio sin reinstalar.";
        }
      }catch(Exception e){status.Text=e.Message;tray.Text="ARMI Estudiante · Reintentando";}
      finally{busy=false;}
    }
    protected override void Dispose(bool disposing){if(disposing){timer.Dispose();tray.Dispose();}base.Dispose(disposing);}
  }
}
