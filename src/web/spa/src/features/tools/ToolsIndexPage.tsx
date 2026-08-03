import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { LinkIcon as DefaultToolIcon } from "@heroicons/react/24/outline";
import { PUBLIC_MODULES } from "../../config/modules";

const stagger = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } };
const fadeUp = { hidden: { opacity: 0, y: 15 }, show: { opacity: 1, y: 0, transition: { duration: 0.35 } } };

/* Cycle distinct neon accent shadows + icon colours so each card pops differently. */
const PANEL_ACCENTS = [
  { card: "", icon: "text-n1" },
  { card: "card-accent-n3", icon: "text-n3" },
  { card: "card-accent-n2", icon: "text-n2" },
  { card: "card-accent-n4", icon: "text-n4" },
];

// The tools directory: every "tools" section module, plus My Info (which
// otherwise lives in the "discover" section — it stays there too, this just
// also surfaces it here since it's a visitor-info tool in its own right).
const MY_INFO_MODULE = PUBLIC_MODULES.find((m) => m.id === "my-info");
const TOOL_CARDS = [
  ...PUBLIC_MODULES.filter((m) => m.section === "tools"),
  ...(MY_INFO_MODULE ? [MY_INFO_MODULE] : []),
];

export default function ToolsIndexPage() {
  return (
    <main className="container-max section-padding">
      <motion.h1
        className="text-4xl sm:text-5xl font-display font-extrabold uppercase tracking-tight text-text-primary mb-10"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        Tools
      </motion.h1>

      <motion.div
        variants={stagger}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
      >
        {TOOL_CARDS.map((mod, i) => {
          const accent = PANEL_ACCENTS[i % PANEL_ACCENTS.length];
          const Icon = mod.icon ?? DefaultToolIcon;
          return (
            <motion.div key={mod.id} variants={fadeUp}>
              <Link to={mod.path} className="block h-full">
                <div className={`card ${accent.card} p-6 group h-full`}>
                  <Icon className={`w-8 h-8 ${accent.icon} mb-4 group-hover:scale-110 transition-transform`} />
                  <h2 className="text-lg font-display font-extrabold uppercase tracking-tight text-text-primary mb-1">
                    {mod.label}
                  </h2>
                  <p className="text-sm text-text-secondary">{mod.description}</p>
                </div>
              </Link>
            </motion.div>
          );
        })}
      </motion.div>
    </main>
  );
}
