import { useEffect, useRef, useState } from "react";
import Sheet from "./Sheet";
import Icon from "./Icon";
import TopBarEditor from "./TopBarEditor";
import { cleanTopBar } from "../brain/mobile/topBarConfig";
import "./quick-start.css";

const GUIDE = [
  { label: "Talk", icon: "mic", detail: "Tap the mic or orb to speak. Type in the message box whenever you prefer." },
  { label: "Chat", icon: "chat", detail: "Open your conversations, revisit replies or start a new chat." },
  { label: "Memory", icon: "memory", detail: "Review what JARVIS remembers. Add or remove saved facts here." },
  { label: "Skills", icon: "skills", detail: "Choose a specialist or open activities like reading and step-by-step guides." },
  { label: "Capabilities", icon: "caps", detail: "See what JARVIS can do and try an example request." },
  { label: "Shortcuts", icon: "layout", detail: "Your top bar is yours. Next, pick the controls you want within reach." },
];

export default function QuickStart({ preferences, onFinish }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(() => cleanTopBar(preferences));
  const body = useRef(null);
  const heading = useRef(null);

  useEffect(() => {
    const panel = body.current?.closest("[role='dialog']");
    if (!panel) return undefined;
    const previous = document.activeElement;
    body.current.scrollTop = 0;
    heading.current?.focus();
    const trapFocus = (event) => {
      if (event.key !== "Tab") return;
      const controls = [...panel.querySelectorAll("button:not(:disabled), input:not(:disabled)")];
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    panel.addEventListener("keydown", trapFocus);
    return () => {
      panel.removeEventListener("keydown", trapFocus);
      if (previous?.isConnected) previous.focus();
    };
  }, [step]);

  const skip = () => onFinish(cleanTopBar(preferences));
  return (
    <Sheet
      open
      title="Welcome to JARVIS"
      onClose={skip}
      onBack={step ? () => setStep(0) : undefined}
      backLabel="Introduction"
      className="quick-start"
      bodyRef={body}
      footer={
        <div className="quick-start__footer">
          <button type="button" className="btn btn--ghost" onClick={skip}>Skip for now</button>
          <button type="button" className="btn btn--primary" onClick={step ? () => onFinish(draft) : () => setStep(1)}>
            {step ? "Use these shortcuts" : "Choose shortcuts"}
            <Icon name="chevronRight" size={17} />
          </button>
        </div>
      }
    >
      <div className="quick-start__progress" aria-label={`Step ${step + 1} of 2`}>
        <span className={step === 0 ? "is-current" : ""} />
        <span className={step === 1 ? "is-current" : ""} />
        <small>{step + 1} of 2</small>
      </div>
      <h1 className="quick-start__title" ref={heading} tabIndex={-1}>
        {step ? "Your bar. Your shortcuts." : "Know your way around."}
      </h1>
      {step ? (
        <TopBarEditor value={draft} onChange={setDraft} showHeading={false} />
      ) : (
        <>
          <p className="quick-start__lede">A quick introduction, then make yourself at home.</p>
          <ol className="quick-start__guide">
            {GUIDE.map(({ label, icon, detail }) => (
              <li key={label}>
                <span className="quick-start__icon"><Icon name={icon} size={22} /></span>
                <div><h2>{label}</h2><p>{detail}</p></div>
              </li>
            ))}
          </ol>
        </>
      )}
    </Sheet>
  );
}
