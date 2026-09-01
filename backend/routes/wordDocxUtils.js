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

const isJpegBuffer = (buffer) => Buffer.isBuffer(buffer)
    && buffer.length >= 3
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[2] === 0xff;

const normalizeDocxEmbeddedImageTypes = (doc) => {
    const zip = doc?.getZip?.();
    if (!zip?.files) return 0;

    const renamed = [];
    Object.keys(zip.files)
        .filter((name) => /^word\/media\/[^/]+\.png$/i.test(name))
        .forEach((name) => {
            const file = zip.file(name);
            if (!file) return;
            const buffer = file.asNodeBuffer();
            if (!isJpegBuffer(buffer)) return;
            const nextName = name.replace(/\.png$/i, '.jpg');
            zip.file(nextName, buffer);
            zip.remove(name);
            renamed.push({
                previousBaseName: name.split('/').pop(),
                nextBaseName: nextName.split('/').pop(),
            });
        });

    if (!renamed.length) return 0;

    Object.keys(zip.files)
        .filter((name) => /\.rels$/i.test(name))
        .forEach((name) => {
            const file = zip.file(name);
            if (!file) return;
            const xml = file.asText();
            const nextXml = renamed.reduce(
                (value, item) => value.split(item.previousBaseName).join(item.nextBaseName),
                xml,
            );
            if (nextXml !== xml) zip.file(name, nextXml);
        });

    const contentTypesName = '[Content_Types].xml';
    const contentTypes = zip.file(contentTypesName)?.asText() || '';
    if (contentTypes && !/<Default\b[^>]*Extension="jpe?g"/i.test(contentTypes)) {
        zip.file(
            contentTypesName,
            contentTypes.replace(
                '</Types>',
                '<Default Extension="jpg" ContentType="image/jpeg"/></Types>',
            ),
        );
    }

    return renamed.length;
};

export {
    normalizeDocxEmbeddedImageTypes,
    sanitizeDocxDrawingIds
};
