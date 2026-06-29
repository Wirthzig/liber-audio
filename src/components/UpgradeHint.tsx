import { Sparkles } from 'lucide-react';
import { SETBRAIN_URL } from '../demoLimits';

interface Props {
    title: string;
    body: string;
    /** Optional secondary action (e.g. "Continue browsing"). */
    continueLabel?: string;
    onContinue?: () => void;
}

/**
 * Gentle, full-card upgrade prompt shown when a demo limit is reached. Violet,
 * never a hard popup over unrelated work. "Learn more" opens the SetBrain site
 * once SETBRAIN_URL is set; until then it shows a "coming soon" affordance.
 */
export function UpgradeHint({ title, body, continueLabel, onContinue }: Props) {
    return (
        <div className="w-full max-w-lg bg-gradient-to-br from-violet-600/20 to-violet-500/[0.04] border border-violet-400/30 rounded-3xl p-10 text-center shadow-2xl">
            <div className="mx-auto mb-5 w-14 h-14 rounded-2xl bg-violet-500/20 border border-violet-400/40 flex items-center justify-center">
                <Sparkles size={26} className="text-violet-300" />
            </div>
            <h2 className="text-2xl font-bold mb-3">{title}</h2>
            <p className="text-gray-300 text-sm leading-relaxed mb-8 max-w-md mx-auto">{body}</p>
            <div className="flex items-center justify-center gap-3">
                {SETBRAIN_URL ? (
                    <a
                        href={SETBRAIN_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-7 py-3 rounded-full bg-violet-500 hover:bg-violet-400 text-white font-bold text-sm transition-all hover:scale-105 shadow-[0_0_25px_rgba(167,139,250,0.4)]"
                    >
                        Learn more about SetBrain
                    </a>
                ) : (
                    <span
                        className="px-7 py-3 rounded-full bg-violet-500/40 text-white/80 font-bold text-sm cursor-default"
                        title="SetBrain website coming soon"
                    >
                        SetBrain — coming soon
                    </span>
                )}
                {onContinue && (
                    <button
                        onClick={onContinue}
                        className="px-6 py-3 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 text-sm font-bold transition-colors"
                    >
                        {continueLabel ?? 'Continue'}
                    </button>
                )}
            </div>
        </div>
    );
}
