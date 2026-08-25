import React, { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";

import { auth, db } from "../services/firebase";
import { UserRole } from "../types/models";

type AuthContextValue = {
  user: User | null;
  userRole: UserRole | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  userRole: null,
  loading: true,
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);

      // Clean up any previous profile listener
      unsubscribeProfile?.();
      unsubscribeProfile = undefined;

      if (firebaseUser) {
        // Listen to the user's Firestore document for real-time role updates
        unsubscribeProfile = onSnapshot(
          doc(db, "users", firebaseUser.uid),
          (snapshot) => {
            if (snapshot.exists()) {
              const data = snapshot.data();
              const role = data.role;
              if (role === "driver" || role === "passenger" || role === "admin") {
                setUserRole(role as UserRole);
              } else {
                setUserRole(null);
              }
            } else {
              setUserRole(null);
            }
            setLoading(false);
          },
          (error) => {
            console.error("Failed to listen to user profile:", error);
            setUserRole(null);
            setLoading(false);
          }
        );
      } else {
        setUserRole(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribeProfile?.();
      unsubscribeAuth();
    };
  }, []);

  const handleSignOut = async () => {
    await signOut(auth);
    setUser(null);
    setUserRole(null);
  };

  return (
    <AuthContext.Provider value={{ user, userRole, loading, signOut: handleSignOut }}>
      {children}
    </AuthContext.Provider>
  );
}
