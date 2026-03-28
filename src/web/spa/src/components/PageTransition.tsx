import React from "react";
import { motion } from "framer-motion";
import { pageTransition } from "./motion";

/**
 * Wrap any page component to get a consistent fade-up enter animation.
 * Uses layout-level AnimatePresence in AppLayout for exit animations.
 */
export const PageTransition: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = "",
}) => (
  <motion.div
    variants={pageTransition}
    initial="initial"
    animate="animate"
    exit="exit"
    className={className}
  >
    {children}
  </motion.div>
);
