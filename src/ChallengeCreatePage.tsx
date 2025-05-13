import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

interface Player {
  id: string;
  name: string;
}

interface Court {
  id: string;
  name: string;
  team_id: string;
}

interface LocationState {
  teamId: string;
  teamName: string;
  playerIds: string[];
}

interface Member {
  id: string;
  name: string;
  team_id: string;
}

export default function ChallengeCreatePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { teamId, teamName, playerIds = [] } = (location.state || {}) as { teamId: string, teamName: string, playerIds: string[] };

  const [members, setMembers] = useState<Member[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [timeSlot, setTimeSlot] = useState('中');
  const [customTimeSlot, setCustomTimeSlot] = useState('');
  const [loading, setLoading] = useState(false);
  const [teamNameState, setTeamName] = useState(teamName || '');

  // 取得 members
  useEffect(() => {
    if (!teamId) return;
    const fetchMembers = async () => {
      const { data, error } = await supabase.from('members').select('id, name, team_id').eq('team_id', teamId);
      if (!error && data) setMembers(data);
    };
    fetchMembers();
  }, [teamId]);

  // 根據 id 找 name
  const getMemberNameById = (id: string) => members.find((m: Member) => m.id === id)?.name || '';

  // 送出挑戰
  const handleSubmit = async () => {
    setLoading(true);
    const [p1, p2, p3, p4] = playerIds.map(getMemberNameById);
    if (!p1) {
      alert('參賽球員1資料有誤，請重新選擇或刷新頁面');
      setLoading(false);
      return;
    }
    try {
      const loginUser = JSON.parse(localStorage.getItem('loginUser') || '{}');
      const initiator = loginUser.name || '';
      const slotToSave = timeSlot === 'custom' ? customTimeSlot : timeSlot;
      if (timeSlot === 'custom' && !customTimeSlot.trim()) {
        alert('請輸入自訂時段');
        setLoading(false);
        return;
      }
      const { error } = await supabase.from('challenges').insert({
        team_name: teamNameState,
        initiator,
        player1: p1,
        player2: p2,
        player3: p3,
        player4: p4,
        challenge_date: selectedDate ? selectedDate.toISOString().split('T')[0] : '',
        time_slot: slotToSave
      });
      if (error) throw error;
      alert('挑戰建立成功');
      navigate('/challenges');
    } catch (error) {
      console.error('建立挑戰失敗:', error);
      alert('建立挑戰失敗');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-8 bg-white rounded shadow p-6 md:p-10">
      <h2 className="text-2xl font-bold mb-4">建立新挑戰</h2>
      <div className="mb-4">
        <h3 className="font-medium mb-2">參賽球員</h3>
        <div className="grid grid-cols-2 gap-2 w-full">
          {playerIds.length === 0 ? (
            <div className="col-span-2 text-red-500">無球員資料</div>
          ) : (
            playerIds.map((playerId) => (
              <div key={playerId} className="p-2 border rounded bg-gray-50 w-full text-center">
                {getMemberNameById(playerId)}
              </div>
            ))
          )}
        </div>
      </div>
      <div className="mb-4">
        <label className="block mb-1">日期</label>
        <DatePicker
          selected={selectedDate}
          onChange={date => setSelectedDate(date)}
          className="w-full p-2 border rounded"
          dateFormat="MM/dd/yyyy"
        />
      </div>
      <div className="mb-4">
        <label className="block mb-1">何時到</label>
        <select
          className="w-full p-2 border rounded"
          value={timeSlot}
          onChange={e => setTimeSlot(e.target.value)}
        >
          <option value="早">早上 (8:00-12:00)</option>
          <option value="中">中午 (13:30-18:00)</option>
          <option value="晚">晚上 (18:00-22:00)</option>
          <option value="custom">自訂</option>
        </select>
        {timeSlot === 'custom' && (
          <input
            type="text"
            className="w-full p-2 border rounded mt-2"
            placeholder="請輸入自訂時段，例如 13:30-15:00"
            value={customTimeSlot}
            onChange={e => setCustomTimeSlot(e.target.value)}
          />
        )}
      </div>
      <div className="flex justify-end space-x-2">
        <button
          onClick={() => navigate(-1)}
          className="px-4 py-2 rounded bg-gray-300 hover:bg-gray-400"
          disabled={loading}
        >
          取消
        </button>
        <button
          onClick={handleSubmit}
          className="px-4 py-2 rounded bg-blue-400 hover:bg-blue-500 text-white"
          disabled={loading || !selectedDate || !timeSlot}
        >
          {loading ? '提交中...' : '發起挑戰'}
        </button>
      </div>
    </div>
  );
}
