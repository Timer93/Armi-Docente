import type { ScheduleConfig, ScheduleEntry } from '../../types';

interface SessionScheduleContext {
    selArea: string;
    selGrade: string;
    selSection: string;
    sessionDate: string;
    dateOptions: Array<{ value?: string }>;
}

export const getSessionDynamicHoursLabel = ({
    selArea,
    selGrade,
    selSection,
    sessionDate,
    dateOptions
}: SessionScheduleContext) => {
    if (!selArea || !selGrade || !selSection) return '-----';

    const datesToProcess = dateOptions.length > 0
        ? dateOptions.map((date) => date.value)
        : (sessionDate ? [sessionDate] : []);

    if (datesToProcess.length === 0) return '-----';

    const savedSchedule = localStorage.getItem('armi_schedule_entries');
    const savedConfig = localStorage.getItem('armi_schedule_config');
    if (!savedSchedule) return '-----';

    try {
        const scheduleEntries: ScheduleEntry[] = JSON.parse(savedSchedule);
        const scheduleConfig: ScheduleConfig = savedConfig
            ? JSON.parse(savedConfig)
            : { breaks: [] } as any;
        const breaks = scheduleConfig.breaks || [];
        const sectionsToCalculate = selSection.split(/, | y /).map((section) => section.trim().toUpperCase());
        const dayNames = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
        const allBlocks: string[] = [];

        datesToProcess.forEach((dateString) => {
            if (!dateString) return;
            const date = new Date(`${dateString}T00:00:00`);
            if (Number.isNaN(date.getTime())) return;

            const dayText = dayNames[date.getDay()];
            sectionsToCalculate.forEach((section) => {
                const sectionEntries = scheduleEntries
                    .filter((entry) =>
                        entry.day.toUpperCase() === dayText
                        && entry.grade.toLowerCase() === selGrade.toLowerCase()
                        && String(entry.section).toUpperCase() === section
                        && (entry.areaName.toLowerCase() === selArea.toLowerCase() || entry.areaId === selArea)
                    )
                    .sort((left, right) => left.hourIndex - right.hourIndex);

                if (sectionEntries.length === 0) return;

                const sessionBlocks: number[] = [];
                let currentSize = 0;
                for (let index = 0; index < sectionEntries.length; index += 1) {
                    currentSize += 1;
                    const current = sectionEntries[index];
                    const next = sectionEntries[index + 1];
                    const hasBreakAfter = breaks.some((item) => item.afterHour === current.hourIndex);
                    const isNextConsecutive = next && next.hourIndex === current.hourIndex + 1;
                    if (!isNextConsecutive || hasBreakAfter) {
                        sessionBlocks.push(currentSize);
                        currentSize = 0;
                    }
                }
                sessionBlocks.forEach((hours) => allBlocks.push(`${hours}h (${hours * 45} min)`));
            });
        });

        const uniqueBlocks = Array.from(new Set(allBlocks)).sort();
        return uniqueBlocks.length > 0 ? uniqueBlocks.join(' - ') : '-----';
    } catch {
        return '-----';
    }
};
