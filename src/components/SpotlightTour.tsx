import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

// --- SPOTLIGHT TOUR (coach marks) ---
// Darkens the whole screen except a cutout around one element at a time
// (the cutout is a fixed div with a giant box-shadow), with an explaining
// tooltip and Next/Back/Skip. Targets are plain CSS selectors — views mark
// elements with data-tour="...". Steps whose target isn't currently in the
// DOM are skipped silently, so one step list can cover conditional UI.

export interface TourStep {
    target: string;   // CSS selector, e.g. '[data-tour="settings"]'
    title: string;
    text: string;
}

const PAD = 8;            // breathing room around the highlighted element
const TIP_W = 320;

// First-visit bookkeeping. The welcome overlay's "Show me around" resets
// every view tour, so re-taking the start tour re-arms the others too.
const seenKey = (id: string) => `tour_seen_${id}`;
export const tourSeen = (id: string) => localStorage.getItem(seenKey(id)) === 'true';
export const markTourSeen = (id: string) => localStorage.setItem(seenKey(id), 'true');
export const resetAllTours = () => {
    for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k?.startsWith('tour_seen_')) localStorage.removeItem(k);
    }
};
// "Skip" on the welcome overlay opts out of the per-view tours too —
// they can always be re-armed via Help → "Show me around".
export const TOUR_IDS = ['home', 'djlibrary', 'spotify', 'soundcloud', 'youtube'];
export const markAllToursSeen = () => TOUR_IDS.forEach(markTourSeen);

export function SpotlightTour({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
    const [index, setIndex] = useState(0);
    const [rect, setRect] = useState<DOMRect | null>(null);

    // Resolve the current step; skip over steps whose target doesn't exist
    // (dir: which way to keep searching when the user navigates)
    const goTo = useCallback((i: number, dir: 1 | -1) => {
        let j = i;
        while (j >= 0 && j < steps.length && !document.querySelector(steps[j].target)) j += dir;
        if (j < 0 || j >= steps.length) { onClose(); return; }
        setIndex(j);
    }, [steps, onClose]);

    // Mount-only: find the first present target. Not keyed on goTo — parents
    // pass inline onClose handlers, and re-running this would snap to step 0.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { goTo(0, 1); }, []);

    const step = steps[index];

    useEffect(() => {
        const measure = () => {
            const el = step ? document.querySelector(step.target) : null;
            setRect(el ? el.getBoundingClientRect() : null);
        };
        measure();
        window.addEventListener('resize', measure);
        // Layout can shift right after mount (animations, async content)
        const t = setTimeout(measure, 350);
        return () => { window.removeEventListener('resize', measure); clearTimeout(t); };
    }, [step]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); goTo(index + 1, 1); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(index - 1, -1); }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [index, goTo, onClose]);

    if (!step || !rect) return null;

    const isLast = !steps.slice(index + 1).some(s => document.querySelector(s.target));
    const hasPrev = steps.slice(0, index).some(s => document.querySelector(s.target));

    // No padding on an axis where the target (nearly) fills the screen —
    // otherwise the highlight spills into neighboring full-height panels
    const padX = rect.width > window.innerWidth * 0.6 ? 0 : PAD;
    const padY = rect.height > window.innerHeight * 0.6 ? 0 : PAD;

    // Tooltip below the cutout when there's room, else above, else (target
    // fills the screen vertically, e.g. the start-screen panels) centered
    // OVER the highlighted element
    const TIP_H = 180; // estimate incl. margin
    const spaceBelow = window.innerHeight - rect.bottom - padY;
    const spaceAbove = rect.top - padY;
    const tipLeft = Math.min(Math.max(rect.left + rect.width / 2 - TIP_W / 2, 16), window.innerWidth - TIP_W - 16);
    const tipTop = spaceBelow >= TIP_H
        ? rect.bottom + padY + 14
        : spaceAbove >= TIP_H
            ? undefined
            : Math.max(16, Math.min(rect.top + rect.height / 2 - TIP_H / 2, window.innerHeight - TIP_H - 16));
    const tipBottom = tipTop === undefined ? window.innerHeight - rect.top + padY + 14 : undefined;

    return (
        <div className="fixed inset-0 z-[70]" style={{ pointerEvents: 'auto' }}>
            {/* Cutout: everything around it is darkened by the box-shadow */}
            <motion.div
                animate={{
                    left: rect.left - padX,
                    top: rect.top - padY,
                    width: rect.width + padX * 2,
                    height: rect.height + padY * 2,
                }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                className="fixed rounded-2xl ring-1 ring-white/40"
                style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.78)' }}
            />

            {/* Tooltip */}
            <motion.div
                key={index}
                initial={{ opacity: 0, y: tipBottom === undefined ? 8 : -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed bg-[#16161d] border border-white/15 rounded-2xl p-5 shadow-2xl"
                style={{ width: TIP_W, left: tipLeft, top: tipTop, bottom: tipBottom }}
            >
                <button
                    onClick={onClose}
                    className="absolute top-3 right-3 text-gray-500 hover:text-white transition-colors"
                    title="Skip tour"
                >
                    <X size={14} />
                </button>
                <h3 className="font-bold text-sm mb-1.5 pr-6 text-white">{step.title}</h3>
                <p className="text-xs text-gray-400 leading-relaxed mb-4">{step.text}</p>
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5">
                        {steps.map((_, i) => (
                            <span key={i} className={`w-1.5 h-1.5 rounded-full transition-colors ${i === index ? 'bg-white' : 'bg-white/20'}`} />
                        ))}
                    </div>
                    <div className="flex items-center space-x-2">
                        {hasPrev && (
                            <button
                                onClick={() => goTo(index - 1, -1)}
                                className="p-2 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 transition-colors"
                            >
                                <ArrowLeft size={12} />
                            </button>
                        )}
                        <button
                            onClick={() => isLast ? onClose() : goTo(index + 1, 1)}
                            className="flex items-center space-x-1.5 px-4 py-2 rounded-full bg-white text-black text-xs font-bold hover:bg-gray-200 transition-colors"
                        >
                            <span>{isLast ? 'Done' : 'Next'}</span>
                            {!isLast && <ArrowRight size={12} />}
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}

// First-visit auto-start: returns whether the tour should render, plus
// controls to start it manually (replay) or close it (marks as seen).
export function useTour(id: string) {
    const [active, setActive] = useState(() => !tourSeen(id));
    return {
        active,
        start: () => setActive(true),
        close: () => { markTourSeen(id); setActive(false); },
    };
}
