export const cleanSessionResourceText = (value: unknown) => {
    if (!value) return '';

    let text = String(value);

    // Decodifica entidades HTML, incluso si llegan codificadas varias veces.
    for (let index = 0; index < 3; index += 1) {
        const textarea = document.createElement('textarea');
        textarea.innerHTML = text;
        const decoded = textarea.value;

        if (decoded === text) break;
        text = decoded;
    }

    text = text
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/p>/gi, ' ')
        .replace(/<li[^>]*>/gi, ' • ')
        .replace(/<\/li>/gi, ' ')
        .replace(/<[^>]+>/g, ' ');

    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    text = textarea.value;

    return text
        .replace(/\u00A0/g, ' ')
        .replace(/&nbsp;|&#160;|&#xA0;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ')
        .trim();
};
