import { Link } from 'react-router-dom'
import { absoluteUrl, Logo, Qr, useDocumentTitle } from '../components/ui'
import { useAuth } from '../lib/auth'
import { DemoButtons } from './Auth'
import '../styles/landing.css'

const GITHUB_URL = 'https://github.com/Dran511/Pila'

export function Landing() {
  useDocumentTitle('Pila: skip the line, not your turn')
  const { user } = useAuth()
  const demoJoin = absoluteUrl('/q/demo')

  return (
    <div className="landing">
      <header className="landing-nav">
        <Logo />
        <nav>
          <a href="#how">How it works</a>
          <a href="#demo">Live demo</a>
          {user ? (
            <Link to={user.role === 'admin' ? '/admin' : '/staff'} className="btn btn-primary btn-sm">
              Open my office
            </Link>
          ) : (
            <>
              <Link to="/login">Sign in</Link>
              <Link to="/signup" className="btn btn-primary btn-sm">
                Set up your office
              </Link>
            </>
          )}
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Real-time queue system · Libre</span>
          <h1>
            Skip the line,
            <br />
            not your turn.
          </h1>
          <p>
            Pila lets people at health centers, barangay halls and government offices get a queue number from their phone,
            then wait anywhere: under a tree, at the sari-sari store, at home nearby. Their phone tells them when it’s
            almost their turn.
          </p>
          <div className="hero-ctas">
            <a href="#demo" className="btn btn-primary btn-lg">
              Try the live demo
            </a>
            <Link to="/signup" className="btn btn-lg">
              Set up your office, free
            </Link>
          </div>
          <ul className="hero-points">
            <li>No app to install</li>
            <li>Priority lane for seniors &amp; PWDs</li>
            <li>English &amp; Filipino</li>
          </ul>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div className="mock-phone">
            <div className="mock-phone-top">Mabini Health Center</div>
            <div className="mock-ticket">
              <span>Your number</span>
              <b>C-014</b>
              <em>Consultation</em>
              <hr />
              <strong>3 people ahead of you</strong>
              <small>Estimated wait: about 12 min</small>
              <div className="mock-dots">
                <i />
                <i />
                <i />
                <i className="you" />
              </div>
            </div>
            <div className="mock-alert">🔔 Alerts on: keep this page open</div>
          </div>
          <div className="mock-tv">
            <span>Now serving</span>
            <div className="mock-tv-grid">
              <div className="flash">
                <small>Window 1</small>
                <b>C-011</b>
              </div>
              <div>
                <small>Window 2</small>
                <b>L-004</b>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section" id="how">
        <h2>How it works</h2>
        <div className="steps">
          <div className="step">
            <span>1</span>
            <h3>Scan at the entrance</h3>
            <p>A QR poster at the door opens the join page. Pick a service and get a number like C-014 in seconds.</p>
          </div>
          <div className="step">
            <span>2</span>
            <h3>Wait anywhere</h3>
            <p>
              The ticket page shows how many people are ahead and an estimated wait, learned from how fast each service has
              actually been moving.
            </p>
          </div>
          <div className="step">
            <span>3</span>
            <h3>Get called</h3>
            <p>
              When staff press “Next”, the TV chimes and announces the number, and the person’s phone lights up with the
              window to go to.
            </p>
          </div>
        </div>

        <div className="audiences">
          <div className="card card-pad">
            <h3>For the public</h3>
            <ul>
              <li>Live position and wait time</li>
              <li>Phone alert when you’re almost up</li>
              <li>Priority lane for seniors, PWDs and pregnant women</li>
              <li>English and Filipino</li>
            </ul>
          </div>
          <div className="card card-pad">
            <h3>For counter staff</h3>
            <ul>
              <li>One button: done, call next</li>
              <li>Recall, no-show, call out of order</li>
              <li>Walk-in tickets for people without phones</li>
              <li>Keyboard shortcuts for speed</li>
            </ul>
          </div>
          <div className="card card-pad">
            <h3>For the office</h3>
            <ul>
              <li>TV display board with voice announcements</li>
              <li>Wait times, no-shows and busiest hours</li>
              <li>Services, counters and staff accounts</li>
              <li>Printable QR poster</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="landing-section demo" id="demo">
        <h2>Try the live demo</h2>
        <p className="muted">
          A fictional barangay health center with two weeks of history. For the full effect, open each view in its own tab,
          or scan the QR code with your phone.
        </p>
        <div className="demo-grid">
          <div className="card card-pad demo-card">
            <span className="demo-step">1</span>
            <h3>Get a number</h3>
            <p className="muted small">What a patient sees after scanning the poster.</p>
            <div className="demo-qr">
              <Qr value={demoJoin} label="QR code for the demo join page" />
            </div>
            <a href="/q/demo" target="_blank" rel="noreferrer" className="btn btn-primary btn-block">
              Open join page ↗
            </a>
          </div>
          <div className="card card-pad demo-card">
            <span className="demo-step">2</span>
            <h3>Watch the display board</h3>
            <p className="muted small">The TV in the waiting area. Click it once to turn on the chime and voice.</p>
            <div className="demo-tv-thumb" aria-hidden="true">
              <b>C-011</b>
              <span>Window 1</span>
            </div>
            <a href="/display/demo" target="_blank" rel="noreferrer" className="btn btn-block">
              Open display board ↗
            </a>
          </div>
          <div className="card card-pad demo-card">
            <span className="demo-step">3</span>
            <h3>Run a counter, see the numbers</h3>
            <p className="muted small">
              Sign in to the demo office with one click. Staff call people; admins also get the dashboard and setup.
            </p>
            <div style={{ marginTop: 'auto' }}>
              <DemoButtons />
            </div>
          </div>
        </div>
      </section>

      <footer className="landing-foot">
        <Logo />
        <p>
          Built by Dran Magdaraog with React, TypeScript, Node.js, PostgreSQL and Socket.IO ·{' '}
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
        </p>
      </footer>
    </div>
  )
}
