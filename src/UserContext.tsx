import React, { createContext } from 'react';

interface User {
  team_id?: string;
  [key: string]: any;
}

interface UserContextType {
  user: User | null;
}

export const UserContext = createContext<UserContextType | undefined>(undefined);

interface UserProviderProps {
  user: User | null;
  children: React.ReactNode;
}

export const UserProvider: React.FC<UserProviderProps> = ({ user, children }) => {
  return (
    <UserContext.Provider value={{ user }}>
      {children}
    </UserContext.Provider>
  );
};