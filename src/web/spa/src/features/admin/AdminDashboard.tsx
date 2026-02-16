import React, { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { PlusIcon } from "@heroicons/react/24/outline";
import { useAuth } from "../../shell/AuthContext";
import { getVisibleAdminModules } from "../../config/modules";

const stagger = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } };
const fadeUp = { hidden: { opacity: 0, y: 15 }, show: { opacity: 1, y: 0, transition: { duration: 0.35 } } };

export function AdminDashboard() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const visibleModules = getVisibleAdminModules(user);

  useEffect(() => {
    if (!isLoading && !user) navigate("/auth");
  }, [user, isLoading, navigate]);

  if (isLoading) {
    return (
      <div className="container-max section-padding text-center">
        <div className="inline-block w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user || visibleModules.length === 0) {
    return (
      <div className="container-max section-padding text-center">
        <h1 className="text-2xl font-display font-bold text-secondary-100 mb-4">
          Access Denied
        </h1>
        <p className="text-secondary-400">
          You don&rsquo;t have permission to access the admin area.
        </p>
      </div>
    );
  }

  return (
    <main className="container-max section-padding">
      <motion.h1
        className="text-4xl sm:text-5xl font-display font-bold text-gradient mb-10"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        Admin
      </motion.h1>

      <motion.div
        variants={stagger}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
      >
        {visibleModules.map((mod) => (
          <motion.div key={mod.path} variants={fadeUp}>
            <div className="card p-6 hover:border-primary-500/50 transition-colors group">
              <Link to={mod.path} className="block">
                <mod.icon className="w-8 h-8 text-primary-500 mb-4 group-hover:scale-110 transition-transform" />
                <h2 className="text-lg font-display font-bold text-secondary-100 mb-1">
                  {mod.label}
                </h2>
                <p className="text-sm text-secondary-400">{mod.description}</p>
              </Link>
              {(mod.id === "websites" || mod.id === "media") && (
                <Link
                  to={mod.path + (mod.id === "websites" ? "?tab=add" : "?tab=add")}
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary-400 hover:text-primary-300 transition-colors"
                >
                  <PlusIcon className="w-4 h-4" />
                  Add {mod.id === "websites" ? "Site" : "Media"}
                </Link>
              )}
            </div>
          </motion.div>
        ))}
      </motion.div>
    </main>
  );
}
