import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import "bootstrap/dist/css/bootstrap.css";
import "./index.scss";
import {
  createBrowserRouter,
  RouterProvider,
  useParams,
} from "react-router-dom";
import HomePage from "./pages/HomePage.js";
import Session from "./pages/Session.js";
import "toastify-js/src/toastify.css";
import NProgress from "nprogress";
import "nprogress/nprogress.css";

// configure nprogress
NProgress.configure({ showSpinner: false });

function DocumentTitle({ title }) {
  const routeParams = useParams();
  useEffect(() => {
    document.title = title(routeParams);
  }, [title]); // Only re-run the effect if the title prop changes

  return null; // This component doesn't render anything
}

const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <>
        <DocumentTitle title={(params) => "Transfer - index"} />
        <HomePage />
      </>
    ),
  },
  {
    path: "/sessions/:id",
    element: (
      <>
        <DocumentTitle title={(params) => `Transfer - ${params.id}`} />
        <Session />
      </>
    ),
  },
]);

const root = ReactDOM.createRoot(document.body);

root.render(<RouterProvider router={router} />);
