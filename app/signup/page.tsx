export default function SignupPage() {
  return (
    <div className="page">
      <div className="eyebrow">Signup · preview auth readiness</div>
      <h1>Create your account</h1>
      <form className="form card">
        <p className="muted">
          Production signup is not connected in this build. Swing Up is not storing passwords manually or charging users here.
        </p>
        <input className="input" placeholder="Name" />
        <input className="input" placeholder="Email" />
        <button className="button primary" type="button">Preview signup disabled</button>
      </form>
    </div>
  );
}
