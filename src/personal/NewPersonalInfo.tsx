import React from 'react';
import NewTodoBlock from './NewTodoBlock';
import NewContestProgressBlock from './NewContestProgressBlock';
import NewAcceptedInvitesBlock from './NewAcceptedInvitesBlock';
import NewStatsBlock from './NewStatsBlock';
import NewRecentGamesBlock from './NewRecentGamesBlock';
import NewProfileBlock from './NewProfileBlock';

const NewPersonalInfo: React.FC = () => {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">新版個人資訊</h2>
      <NewTodoBlock />
      <NewContestProgressBlock />
      <NewAcceptedInvitesBlock />
      <NewStatsBlock />
      <NewRecentGamesBlock />
      <NewProfileBlock />
    </div>
  );
};

export default NewPersonalInfo; 