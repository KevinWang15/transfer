import React from "react";
import * as uuid from "uuid";
import withRouter from "../utils/withRouter.js";
import toast from "../utils/toast.js";

class HomePage extends React.Component {
  state = {};

  componentDidMount() {}

  render() {
    return (
      <div className="App">
        <div
          className="container"
          style={{ marginTop: 20, textAlign: "center" }}
        >
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
        </div>
      </div>
    );
  }
}

export default withRouter(HomePage);
