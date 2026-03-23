import React, { Fragment } from "react";
import { NavLink } from "react-router-dom";
import { Menu, Transition } from "@headlessui/react";
import { UserCircleIcon } from "@heroicons/react/24/outline";

interface UserMenuProps {
  email: string;
  onSignOut: () => void;
}

export function UserMenu({ email, onSignOut }: UserMenuProps) {
  return (
    <Menu as="div" className="relative">
      <Menu.Button className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-colors duration-150">
        <UserCircleIcon className="w-5 h-5" />
        <span className="hidden lg:inline truncate max-w-[140px] text-xs">
          {email}
        </span>
      </Menu.Button>

      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="transform opacity-0 scale-95"
        enterTo="transform opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="transform opacity-100 scale-100"
        leaveTo="transform opacity-0 scale-95"
      >
        <Menu.Items className="absolute right-0 top-full mt-1 w-48 rounded-md border border-border-default bg-surface-2 py-1 shadow-lg z-50 focus:outline-none">
          <div className="px-3 py-2 border-b border-border-subtle">
            <p className="text-xs text-text-tertiary truncate">{email}</p>
          </div>
          <Menu.Item>
            {({ active }) => (
              <NavLink
                to="/profile"
                className={`block px-3 py-2 text-sm transition-colors duration-150 ${
                  active ? "bg-surface-3 text-text-primary" : "text-text-secondary"
                }`}
              >
                Profile
              </NavLink>
            )}
          </Menu.Item>
          <Menu.Item>
            {({ active }) => (
              <button
                onClick={onSignOut}
                className={`block w-full text-left px-3 py-2 text-sm transition-colors duration-150 ${
                  active ? "bg-surface-3 text-red-400" : "text-red-400/80"
                }`}
              >
                Sign out
              </button>
            )}
          </Menu.Item>
        </Menu.Items>
      </Transition>
    </Menu>
  );
}
