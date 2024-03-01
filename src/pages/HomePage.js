import React from "react";
import * as uuid from "uuid";
import withRouter from "../utils/withRouter.js";
import toast from "../utils/toast.js";
import "./HomePage.scss";
import Swal from "sweetalert2";

class HomePage extends React.Component {
  state = {};

  componentDidMount() {}

  render() {
    return (
      <div className="homepage">
        <div
          className="container"
          style={{ marginTop: 20, textAlign: "center" }}
        >
          <div className="logo">
            <img src="/logo.png" alt="" />
          </div>
          <button
            className={"btn btn-primary"}
            onClick={() => {
              const sessionId = uuid.v4();
              this.props.router.navigate("/sessions/" + sessionId);
              toast(
                "Session created; distribute the current URL to allow others to participate.",
                { duration: 5000 }
              );
              // window.location.href = "/sessions/" + sessionId;
            }}
          >
            Create a new transfer session
          </button>
          <hr />
          <span>Or,</span>
          <button
            className={"btn btn-primary"}
            onClick={async () => {
              const sessionId = await promptForSessionName();
              if (!sessionId) {
                return;
              }

              this.props.router.navigate("/sessions/" + sessionId);
              toast(
                "Session created; distribute the current URL to allow others to participate.",
                { duration: 5000 }
              );
              // window.location.href = "/sessions/" + sessionId;
            }}
          >
            Create a new named transfer session
          </button>
          <hr />
          Or join an existing transfer session with a link
        </div>
      </div>
    );
  }
}

function promptForSessionName() {
  return Swal.fire({
    title: "Enter Session Name",
    input: "text",
    inputLabel:
      "Your session name (10 characters required)\nDon't use easy-to-guess names as this is a public service. \n\nIf they guessed the names,\nthey can join your session and see your data.)",
    inputPlaceholder: "Enter name here...",
    inputAttributes: {
      minlength: 10, // Limit to 10 characters
      required: true, // Make field mandatory
    },
    showCancelButton: true,
    inputValidator: (value) => {
      if (value.length < 10) {
        return "Session name must be at least 10 characters long!";
      }
    },
  }).then((result) => {
    if (result.isConfirmed) {
      return result.value;
    }
  });
}

export default withRouter(HomePage);
