/* Orb.jsx — JARVIS's presence on the home screen: soft colour fields swirling in a
   sphere, in the theme's accent. Its motion says what JARVIS is doing (slow when
   idle, ripples while listening, an orbiting arc while thinking or working, a pulse
   while speaking). Pure CSS animation (home.css), so it costs no JS per frame. */

export default function Orb({ status = "idle", label, onClick }) {
  return (
    <button
      type="button"
      className={`orb orb--${status}`}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <span className="orb-halo" aria-hidden />
      <span className="orb-ripple" aria-hidden />
      <span className="orb-ripple orb-ripple--2" aria-hidden />
      <span className="orb-arc" aria-hidden />
      <span className="orb-ball" aria-hidden>
        <span className="orb-swirl">
          <span className="orb-blob orb-blob--a" />
          <span className="orb-blob orb-blob--b" />
          <span className="orb-blob orb-blob--c" />
        </span>
        <span className="orb-shine" />
      </span>
    </button>
  );
}
