import '../../backend/public/student-photo-viewer.js';
import '../../backend/public/student-photo-viewer.css';

export function openStudentPhoto(studentId: string | number, name: string, source?: string) {
  const url = `/api/student-forum/teacher/profiles/${encodeURIComponent(String(studentId))}`;
  return (window as any).armiStudentPhotoViewer.open({name, source: source || url, replace: async (file: File) => {
    const body = new FormData(); body.append('file', file);
    const response = await fetch(url, {method:'PUT', body});
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || 'No se pudo guardar la foto.');
    window.dispatchEvent(new CustomEvent('armi:student-photo-updated', {detail:{studentId:String(studentId)}}));
    document.querySelectorAll<HTMLImageElement>('img[data-student-photo-id]').forEach(image => {
      if(image.dataset.studentPhotoId===String(studentId)) {image.style.visibility='';image.src=`${image.src.split('?')[0]}?photo=${Date.now()}`;}
    });
    return url;
  }});
}
