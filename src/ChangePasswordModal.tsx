import React, { useState } from 'react';
import { supabase } from './supabaseClient';

export default function ChangePasswordModal({ memberId, onSuccess, onCancel }) {
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChangePwd = async () => {
    setError('');
    if (!oldPwd || !newPwd || !confirmPwd) {
      setError('請完整填寫所有欄位');
      return;
    }
    if (newPwd !== confirmPwd) {
      setError('新密碼與確認密碼不一致');
      return;
    }
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc('change_member_password', {
      p_member_id: memberId,
      p_old_password: oldPwd,
      p_new_password: newPwd,
    });
    setLoading(false);
    if (rpcError) {
      setError('修改失敗，請稍後再試');
      return;
    }
    if (data === true) {
      onSuccess();
    } else {
      setError('舊密碼錯誤');
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-30 z-50">
      <div className="bg-white p-8 rounded-lg shadow-lg w-80">
        <h2 className="text-xl font-bold mb-4 text-red-600">首次登入請修改密碼</h2>
        <input
          className="w-full mb-3 p-2 border rounded"
          type="password"
          placeholder="舊密碼"
          value={oldPwd}
          onChange={e => setOldPwd(e.target.value)}
        />
        <input
          className="w-full mb-3 p-2 border rounded"
          type="password"
          placeholder="新密碼"
          value={newPwd}
          onChange={e => setNewPwd(e.target.value)}
        />
        <input
          className="w-full mb-3 p-2 border rounded"
          type="password"
          placeholder="確認新密碼"
          value={confirmPwd}
          onChange={e => setConfirmPwd(e.target.value)}
        />
        {error && <div className="text-red-600 mb-2">{error}</div>}
        <div className="flex justify-between">
          <button
            className="px-4 py-2 bg-blue-600 text-white rounded"
            onClick={handleChangePwd}
            disabled={loading}
          >
            {loading ? '處理中...' : '修改密碼'}
          </button>
          <button
            className="px-4 py-2 bg-gray-400 text-white rounded"
            onClick={onCancel}
            disabled={loading}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}