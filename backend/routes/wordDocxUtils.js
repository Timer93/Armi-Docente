const DOCX_XML_PATTERN = /^word\/(?:document|header\d+|footer\d+|endnotes|footnotes)\.xml$/;

const collectUsedDrawingIds = (xml) => {
    const usedIds = new Set();
    const text = String(xml || '');
    const patterns = [
        /<wp:docPr\b[^>]*\bid="(\d+)"/g,
        /<pic:cNvPr\b[^>]*\bid="(\d+)"/g
    ];

    patterns.forEach((pattern) => {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const id = Number(match[1]);
            if (Number.isInteger(id) && id > 0) usedIds.add(id);
        }
    });

    return usedIds;
};

const getNextAvailableId = (usedIds) => {
    let nextId = 1;
    while (usedIds.has(nextId)) nextId++;
    usedIds.add(nextId);
    return nextId;
};

const normalizeDrawingIdsInXml = (xml, usedIds) => {
    let nextXml = String(xml || '');
    const patterns = [
        /(<wp:docPr\b[^>]*\bid=")(\d+)(")/g,
        /(<pic:cNvPr\b[^>]*\bid=")(\d+)(")/g
    ];

    patterns.forEach((pattern) => {
        nextXml = nextXml.replace(pattern, (_match, start, _id, end) => `${start}${getNextAvailableId(usedIds)}${end}`);
    });

    return nextXml;
};

const sanitizeDocxDrawingIds = (doc) => {
    const zip = doc?.getZip?.();
    if (!zip?.files) return;

    const xmlNames = Object.keys(zip.files)
        .filter((name) => DOCX_XML_PATTERN.test(name))
        .sort((left, right) => left.localeCompare(right, 'en'));

    const usedIds = new Set();
    xmlNames.forEach((name) => {
        const xml = zip.file(name)?.asText() || '';
        collectUsedDrawingIds(xml).forEach((id) => usedIds.add(id));
    });

    xmlNames.forEach((name) => {
        const xml = zip.file(name)?.asText() || '';
        const nextXml = normalizeDrawingIdsInXml(xml, usedIds);
        if (nextXml !== xml) zip.file(name, nextXml);
    });
};

export {
    sanitizeDocxDrawingIds
};
