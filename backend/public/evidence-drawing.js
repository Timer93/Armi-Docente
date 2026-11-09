// Serializable strokes keep drawings small, auditable and independent of device resolution.
export function validTemplateDrawing(value) {
  if(value==='')return true;
  try {
    const drawing=JSON.parse(value);
    if(drawing.version!==1 || !Array.isArray(drawing.strokes) || drawing.strokes.length>200)return false;
    let points=0;
    for(const stroke of drawing.strokes){
      if(!/^#[a-f0-9]{6}$/i.test(stroke.color) || !Number.isFinite(stroke.width) || stroke.width<1 || stroke.width>12 || !Array.isArray(stroke.points) || !stroke.points.length)return false;
      points+=stroke.points.length;if(points>2500)return false;
      if(stroke.points.some(p=>!Array.isArray(p)||p.length!==2||p.some(n=>!Number.isFinite(n)||n<0||n>1)))return false;
    }
    return true;
  }catch{return false;}
}
// Runs only in ARMI's isolated frame or an immutable exported copy.
export function paintTemplateDrawing(canvas,value) {
  const context=canvas.getContext('2d');if(!context)return;
  context.clearRect(0,0,canvas.width,canvas.height);
  let data;try{data=JSON.parse(value || '{"strokes":[]}');}catch{return;}
  for(const stroke of data.strokes || []){
    context.strokeStyle=stroke.color;context.fillStyle=stroke.color;context.lineWidth=stroke.width;context.lineCap='round';context.lineJoin='round';context.beginPath();
    stroke.points.forEach(([x,y],index)=>index?context.lineTo(x*canvas.width,y*canvas.height):context.moveTo(x*canvas.width,y*canvas.height));context.stroke();
    if(stroke.points.length===1){const [x,y]=stroke.points[0];context.beginPath();context.arc(x*canvas.width,y*canvas.height,stroke.width/2,0,Math.PI*2);context.fill();}
  }
}
