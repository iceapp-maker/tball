import React, { useContext } from 'react';
import { UserContext } from '../UserContext';

const NewProfileBlock: React.FC = () => {
  const { user } = useContext(UserContext) ?? { user: null };

  return (
    <div className="mb-6 p-4 bg-white rounded shadow">
      <h3 className="font-bold mb-2 text-lg">個人基本資料</h3>
      <div>姓名：{user?.name || '未登入'}</div>
      <div>Email：{user?.email || '--'}</div>
      <div>團隊：{user?.team_name || user?.team_id || '--'}</div>
      <div>身份：{user?.role || '--'}</div>
    </div>
  );
};
export default NewProfileBlock; 