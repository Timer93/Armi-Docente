import React from 'react';
import type { Student } from '../../types';
import { normalizeLoose } from './shared';

type GradingSectionTabsProps = {
    sections: string[];
    activeSection: string;
    students: Student[];
    onChange: (section: string) => void;
};

export const GradingSectionTabs: React.FC<GradingSectionTabsProps> = ({
    sections,
    activeSection,
    students,
    onChange
}) => {
    if (sections.length <= 1) return null;

    return (
        <div className="flex flex-wrap gap-2">
            {sections.map(section => {
                const isActive = section === activeSection;
                const normalizedSection = normalizeLoose(section);
                const sectionCount = students.filter(student =>
                    normalizeLoose(student.section) === normalizedSection
                ).length;

                return (
                    <button
                        key={`grading-section-${section}`}
                        type="button"
                        onClick={() => onChange(section)}
                        className={`px-4 py-2 rounded-2xl border text-[11px] font-black uppercase tracking-widest transition-all ${
                            isActive
                                ? 'bg-slate-900 text-white border-slate-900 shadow-lg'
                                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                        }`}
                    >
                        {section} · {sectionCount} est.
                    </button>
                );
            })}
        </div>
    );
};
