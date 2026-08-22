import React from "react";
import * as uuid from "uuid";
import withRouter from "../utils/withRouter.js";
import toast from "../utils/toast.js";
import "./HomePage.scss";
import Swal from "sweetalert2";
import { IonIcon } from "@ionic/react";
import {
  arrowForwardOutline,
  checkmarkCircleOutline,
  flashOutline,
  keyOutline,
  lockClosedOutline,
  peopleOutline,
  shieldCheckmarkOutline,
  swapHorizontalOutline,
} from "ionicons/icons/index.js";

class HomePage extends React.Component {
  createSession = (sessionId) => {
    this.props.router.navigate(`/sessions/${sessionId}`);
    toast("Session ready — share the link to invite someone.", {
      duration: 5000,
    });
  };

  createInstantSession = () => {
    this.createSession(uuid.v4());
  };

  createNamedSession = async () => {
    const sessionId = await promptForSessionName();
    if (sessionId) {
      this.createSession(sessionId);
    }
  };

  render() {
    return (
      <div className="homepage">
        <div className="home-glow home-glow-one" aria-hidden="true" />
        <div className="home-glow home-glow-two" aria-hidden="true" />

        <header className="home-nav">
          <a className="brand" href="/" aria-label="Transfer home">
            <span className="brand-mark" aria-hidden="true">
              <IonIcon icon={swapHorizontalOutline} />
            </span>
            <span className="brand-name">Transfer</span>
          </a>
          <div className="home-security-pill">
            <IonIcon icon={lockClosedOutline} />
            Encrypted by design
          </div>
        </header>

        <main className="home-main">
          <section className="home-hero">
            <div className="home-eyebrow">
              <span className="home-eyebrow-dot" />
              Fast, private, and built for big files
            </div>
            <h1>
              Move files.
              <span>Stay in flow.</span>
            </h1>
            <p className="home-lede">
              Open a focused transfer space in one click. Share the link, then
              send large files, images, and notes from any device.
            </p>

            <div className="home-actions">
              <button
                type="button"
                className="primary-action"
                onClick={this.createInstantSession}
              >
                Start a session
                <IonIcon icon={arrowForwardOutline} />
              </button>
              <button
                type="button"
                className="secondary-action"
                onClick={this.createNamedSession}
              >
                <IonIcon icon={keyOutline} />
                Choose a session name
              </button>
            </div>

            <div className="home-action-note">
              <IonIcon icon={checkmarkCircleOutline} />
              No account required. Anyone with the link can join.
            </div>
          </section>

          <aside className="transfer-demo" aria-hidden="true">
            <div className="demo-window-bar">
              <div className="demo-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <span>Live transfer</span>
              <div className="demo-live">
                <span /> Connected
              </div>
            </div>

            <div className="demo-content">
              <div className="demo-room-label">TODAY · PROJECT ATLAS</div>

              <div className="demo-file demo-file-complete">
                <div className="demo-file-icon">
                  <IonIcon icon={checkmarkCircleOutline} />
                </div>
                <div className="demo-file-copy">
                  <strong>brand-assets.zip</strong>
                  <span>1.8 GB · Complete</span>
                </div>
                <span className="demo-file-status">100%</span>
              </div>

              <div className="demo-file demo-file-active">
                <div className="demo-file-icon">
                  <IonIcon icon={flashOutline} />
                </div>
                <div className="demo-file-copy">
                  <strong>launch-film.mov</strong>
                  <span>3.4 GB of 4.7 GB · 38.2 MB/s</span>
                  <div className="demo-progress">
                    <span />
                  </div>
                </div>
                <span className="demo-file-status">72%</span>
              </div>

              <div className="demo-note">
                <div className="demo-note-avatar">M</div>
                <div>
                  <span>Shared note</span>
                  <p>The latest build is ready for review.</p>
                </div>
              </div>
            </div>

            <div className="demo-share-bar">
              <div className="demo-avatars" aria-hidden="true">
                <span>KW</span>
                <span>ML</span>
                <span>+2</span>
              </div>
              <div>
                <strong>One link, every device</strong>
                <span>Keep everyone in the same flow</span>
              </div>
            </div>
          </aside>
        </main>

        <footer className="home-trust">
          <div>
            <IonIcon icon={shieldCheckmarkOutline} />
            <span>
              <strong>Encrypted uploads</strong>
              Protected before leaving your browser
            </span>
          </div>
          <div>
            <IonIcon icon={flashOutline} />
            <span>
              <strong>Built for large files</strong>
              Parallel, resumable transfers
            </span>
          </div>
          <div>
            <IonIcon icon={peopleOutline} />
            <span>
              <strong>Effortless sharing</strong>A link is all your team needs
            </span>
          </div>
        </footer>
      </div>
    );
  }
}

function promptForSessionName() {
  return Swal.fire({
    title: "Name your session",
    input: "text",
    inputLabel:
      "Use at least 10 characters and make it hard to guess. Anyone who knows the name can open the session.",
    inputPlaceholder: "e.g. atlas-review-august",
    confirmButtonText: "Create session",
    cancelButtonText: "Cancel",
    showCancelButton: true,
    inputAttributes: {
      minlength: 10,
      autocomplete: "off",
      autocapitalize: "off",
      spellcheck: "false",
      required: true,
    },
    inputValidator: (value) => {
      if (value.trim().length < 10) {
        return "Use at least 10 characters for a safer session name.";
      }
    },
  }).then((result) => (result.isConfirmed ? result.value.trim() : null));
}

export default withRouter(HomePage);
