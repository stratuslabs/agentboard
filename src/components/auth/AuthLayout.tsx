import { Logo, Wordmark, cx } from "../ui";

interface AuthLayoutProps {
  /** Small mono line above the title, e.g. "GET STARTED". */
  kicker?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** The art panel's caption: a mono kicker and one line. */
  caption?: { kicker: string; line: string };
  /** A step indicator, e.g. { current: 2, total: 4 }. */
  step?: { current: number; total: number };
  /** Top-right of the form column, e.g. a "Skip for now" link. */
  topRight?: React.ReactNode;
  /** Wider form column, for steps that show a prompt or a list. */
  wide?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

const DEFAULT_CAPTION = { kicker: "Common ground", line: "One board for the people and the agents doing the work." };

/** Sign-in and onboarding: the brand art on the left, one focused form on the right. */
export default function AuthLayout({ kicker, title, subtitle, caption = DEFAULT_CAPTION, step, topRight, wide, children, footer }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen bg-bg">
      <aside
        className="sticky top-0 flex h-screen w-[520px] shrink-0 flex-col justify-between border-r border-border bg-[#050505] bg-cover bg-center p-10 max-lg:hidden"
        style={{ backgroundImage: "url(/brand-art.webp)" }}
      >
        <div className="flex items-center gap-2.5">
          <Logo size={28} />
          <Wordmark className="text-[15px]" />
        </div>
        <div className="flex flex-col gap-2.5">
          <span className="font-mono text-[11px] tracking-[1px] text-text-3 uppercase">{caption.kicker}</span>
          <p className="text-[22px] leading-[1.3] font-medium tracking-[-0.4px] text-text-1">{caption.line}</p>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col px-14 py-10 max-md:px-5 max-md:py-6">
        <div className="flex min-h-5 items-center gap-4">
          <div className="flex flex-1 items-center gap-1.5">
            <span className="mr-2 flex items-center gap-2 lg:hidden">
              <Logo size={22} />
              <Wordmark className="text-[13px]" />
            </span>
            {step && (
              <>
                {Array.from({ length: step.total }, (_, i) => (
                  <span key={i} className={cx("h-[3px] rounded-sm", i + 1 === step.current ? "w-7 bg-ivory" : i + 1 < step.current ? "w-3.5 bg-text-3" : "w-3.5 bg-surface-4")} />
                ))}
                <span className="ml-1.5 font-mono text-[10.5px] tracking-[0.8px] text-text-3 uppercase">Step {step.current} of {step.total}</span>
              </>
            )}
          </div>
          {topRight}
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className={cx("flex w-full flex-col gap-6", wide ? "max-w-[560px]" : "max-w-[400px]")}>
            <div className="flex flex-col gap-2.5">
              {kicker && <span className="font-mono text-[11px] tracking-[1px] text-text-3 uppercase">{kicker}</span>}
              <h1 className="text-[28px] leading-[1.2] font-semibold tracking-[-0.6px] text-text-1">{title}</h1>
              {subtitle && <div className="text-[14px] leading-[1.55] text-text-2">{subtitle}</div>}
            </div>
            {children}
            {footer && <div className="text-center text-[13px] text-text-3">{footer}</div>}
          </div>
        </div>
      </main>
    </div>
  );
}

/** Inline error under a form. */
export function FormError({ children }: { children: React.ReactNode }) {
  return <div role="alert" className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-[13px] text-danger">{children}</div>;
}

/** Inline success/info note under a form. */
export function FormNote({ children }: { children: React.ReactNode }) {
  return <div role="status" className="rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-[13px] text-success">{children}</div>;
}
