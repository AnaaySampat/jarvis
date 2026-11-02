import { useState } from "react";
import Sheet, { Field } from "./Sheet";

export default function TaskPasskeyPrompt({ request, onRespond }) {
  const [passkey, setPasskey] = useState("");
  const cancel = () => { setPasskey(""); onRespond(null); };
  return (
    <Sheet open title="Enter laptop task passkey" onClose={cancel}>
      <form className="sp-sheet" onSubmit={(event) => {
        event.preventDefault();
        if (onRespond(passkey)) setPasskey("");
      }}>
        <p className="sp-lede">Enter the passkey you set on your laptop for this task.</p>
        <p>{request.goal}</p>
        <Field label="Laptop task passkey" hint="Required for each new phone task. This phone does not save it.">
          <input className="sp-input" type="password" value={passkey}
            autoComplete="off" autoCapitalize="none" spellCheck={false}
            minLength={8} maxLength={128} required autoFocus
            aria-label="Laptop task passkey" onChange={(event) => setPasskey(event.target.value)} />
        </Field>
        <button className="sp-btn" type="submit" disabled={passkey.length < 8}>Continue</button>
        <button className="sp-btn sp-btn--quiet" type="button" onClick={cancel}>Cancel task</button>
      </form>
    </Sheet>
  );
}
