import React from "react";
import { useAuth } from "../../shell/AuthContext";
import GuestLanding from "./GuestLanding";
import Dashboard from "./Dashboard";

/** `/` — guest landing when signed out, dashboard when signed in. While auth resolves, show the landing (no dashboard flash for guests). */
const HomePage: React.FC = () => {
  const { user } = useAuth();
  return user ? <Dashboard /> : <GuestLanding />;
};

export default HomePage;
