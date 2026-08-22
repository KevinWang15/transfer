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
import FeedbackHost from "./components/FeedbackHost.js";

function DocumentTitle({ title }) {
  const routeParams = useParams();
  const nextTitle = title(routeParams);
  useEffect(() => {
    document.title = nextTitle;
  }, [nextTitle]);

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

root.render(
  <>
    <RouterProvider router={router} />
    <FeedbackHost />
  </>
);
