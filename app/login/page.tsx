export default function LoginPage() {
  return (
    <div className="page">
      <div className="eyebrow">Login · preview auth readiness</div>
      <h1>Welcome back</h1>
      <form className="form card">
        <p className="muted">
          Production authentication is not connected in this build. This shell does not submit passwords or create a real session yet.
        </p>
        <input className="input" placeholder="Email" />
        <input className="input" placeholder="Password" type="password" />
        <button className="button primary" type="button">Preview login disabled</button>
      </form>
    </div>
  );
}
