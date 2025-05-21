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
  playerNames?: string[]; // 新增球員名稱參數
  matchDetailId?: string; // 新增 matchDetailId 參數，設為可選以兼容舊的呼叫
}

interface Member {
  id: string;
  name: string;
  team_id: string;
}

export default function ChallengeCreatePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { teamId, teamName, playerIds = [], playerNames = [], matchDetailId } = (location.state || {}) as LocationState;

  const [members, setMembers] = useState<Member[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [timeSlot, setTimeSlot] = useState('中');
  const [customTimeSlot, setCustomTimeSlot] = useState('');
  const [loading, setLoading] = useState(false);
  const [teamNameState, setTeamName] = useState(teamName || '');
  // 定義Challenge介面
  interface Challenge {
    challenge_id: string;
    initiator: string;
    challenge_date: string;
    match_detail_id: string;
    team_name: string;
    player1?: string;
    player2?: string;
    player3?: string;
    player4?: string;
    time_slot: string;
  }
  
  const [existingChallenges, setExistingChallenges] = useState<Challenge[]>([]);
  const [checkingRecords, setCheckingRecords] = useState(false);

  // 取得 members
  useEffect(() => {
    if (!teamId) return;
    const fetchMembers = async () => {
      const { data, error } = await supabase.from('members').select('id, name, team_id').eq('team_id', teamId);
      if (!error && data) setMembers(data);
    };
    fetchMembers();

    // 從courts表格獲取團隊名稱
    const fetchTeamNameFromCourts = async () => {
      const { data, error } = await supabase
        .from('courts')
        .select('name')
        .eq('team_id', teamId)
        .single();
      
      if (!error && data) {
        setTeamName(data.name); // 設定團隊名稱
      } else {
        console.error('獲取團隊名稱失敗:', error);
        // 如果從courts表中獲取失敗，繼續嘗試從teams表獲取
        const { data: teamData, error: teamError } = await supabase
          .from('teams')
          .select('name')
          .eq('id', teamId)
          .single();
        
        if (!teamError && teamData) {
          setTeamName(teamData.name);
        }
      }
    };
    
    fetchTeamNameFromCourts();
  }, [teamId, teamName]);

  // 檢查是否有現有的約戰記錄
  useEffect(() => {
    if (matchDetailId) {
      checkExistingChallenges();
    }
  }, [matchDetailId]);

  // 檢查是否有現有的約戰記錄
  const checkExistingChallenges = async () => {
    if (!matchDetailId) return;
    
    setCheckingRecords(true);
    try {
      const cleanMatchDetailId = String(matchDetailId).trim();
      console.log('檢查現有約戰記錄，match_detail_id:', cleanMatchDetailId);
      
      const { data, error } = await supabase
        .from('challenges')
        .select('*')
        .eq('match_detail_id', cleanMatchDetailId);
      
      if (error) {
        console.error('查詢約戰記錄失敗:', error);
      } else {
        console.log('查詢結果:', data);
        setExistingChallenges(data || []);
      }
    } catch (err) {
      console.error('檢查約戰記錄時出錯:', err);
    } finally {
      setCheckingRecords(false);
    }
  };

  // 根據 id 找 name
  const getMemberNameById = (id: string) => members.find((m: Member) => m.id === id)?.name || '';

  // 送出挑戰
  const handleSubmit = async () => {
    setLoading(true);
    
    // 優先使用傳入的球員名稱，如果沒有才使用資料庫查詢
    const getPlayerName = (id: string, index: number) => {
      return playerNames[index] || getMemberNameById(id);
    };
    
    const p1 = playerIds[0] ? getPlayerName(playerIds[0], 0) : '';
    const p2 = playerIds[1] ? getPlayerName(playerIds[1], 1) : '';
    const p3 = playerIds[2] ? getPlayerName(playerIds[2], 2) : '';
    const p4 = playerIds[3] ? getPlayerName(playerIds[3], 3) : '';
    
    // 簡化驗證，只檢查是否有球員
    if (playerIds.length === 0) {
      alert('請至少選擇一名球員');
      setLoading(false);
      return;
    }

    // 確保有團隊名稱
    let finalTeamName = teamNameState;

    if (!finalTeamName) {
      alert('無法獲取團隊名稱，請返回重試');
      setLoading(false);
      return;
    }

    // 檢查是否有現有的約戰記錄
    if (matchDetailId && existingChallenges.length > 0) {
      const confirmDelete = window.confirm(`已發現 ${existingChallenges.length} 筆相同的約戰記錄！是否要刪除舊記錄並新增此約戰？`);
      if (!confirmDelete) {
        setLoading(false);
        return;
      }
      
      // 用戶確認刪除，繼續處理
      console.log('用戶確認刪除現有記錄');
    }

    try {
      // 如果有現有記錄且用戶確認刪除，先刪除現有記錄
      if (matchDetailId && existingChallenges.length > 0) {
        for (const challenge of existingChallenges) {
          if (!challenge.challenge_id) continue;
          
          console.log('刪除約戰記錄:', challenge.challenge_id);
          const { error: deleteError } = await supabase
            .from('challenges')
            .delete()
            .eq('challenge_id', challenge.challenge_id);
          
          if (deleteError) {
            console.error('刪除舊約戰記錄失敗:', deleteError);
            alert('刪除舊約戰記錄失敗，無法新增約戰');
            setLoading(false);
            return;
          }
        }
        console.log('所有舊記錄刪除完成');
      }
      const loginUser = JSON.parse(localStorage.getItem('loginUser') || '{}');
      const initiator = loginUser.name || '';
      const slotToSave = timeSlot === 'custom' ? customTimeSlot : timeSlot;
      if (timeSlot === 'custom' && !customTimeSlot.trim()) {
        alert('請輸入自訂時段');
        setLoading(false);
        return;
      }
      const { data: challengeData, error } = await supabase.from('challenges').insert({
        team_name: finalTeamName, // 使用確保是團隊名稱的變數
        initiator,
        player1: p1,
        player2: p2,
        player3: p3,
        player4: p4,
        challenge_date: selectedDate ? selectedDate.toISOString().split('T')[0] : '',
        time_slot: slotToSave,
        match_detail_id: matchDetailId || null // 若有 matchDetailId 則寫入，否則為 null
      }).select();
      if (error) throw error;
      
      // 取得新建立的挑戰記錄的 status_code
      if (challengeData && challengeData.length > 0) {
        const statusCode = challengeData[0].status_code;
        console.log('新建立的挑戰記錄:', challengeData[0]);
        
        // 判斷發起人是哪一位參與者
        let initiatorField = '';
        if (p1 === initiator) initiatorField = 'player1_status';
        else if (p2 === initiator) initiatorField = 'player2_status';
        else if (p3 === initiator) initiatorField = 'player3_status';
        else if (p4 === initiator) initiatorField = 'player4_status';
        
        if (initiatorField && statusCode) {
          // 如果發起人是參與者之一，將其狀態設為"已接受"
          console.log('更新發起人狀態為已接受, 欄位:', initiatorField);
          const updateObj: any = {};
          updateObj[initiatorField] = '已接受';
          
          const { data: updateData, error: updateError } = await supabase
            .from('challenge_status_logs')
            .update(updateObj)
            .eq('status_code', statusCode);
            
          if (updateError) {
            console.error('更新發起人狀態失敗:', updateError);
          } else {
            console.log('發起人狀態更新成功:', updateData);
          }
        }
      }
      alert('挑戰建立成功');
      
      // 如果是從比賽戰況室進來的（有 matchDetailId），則跳轉回上一頁
      if (matchDetailId) {
        console.log('從比賽戰況室進來的，返回上一頁');
        navigate(-1);
      } else {
        // 否則跳轉到挑戰列表頁
        navigate('/challenges');
      }
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
      
      {/* Debug 顯示區域 */}
      <div className="mb-4 p-2 bg-gray-100 border border-gray-200 rounded text-xs">
        <div><span className="font-bold">Debug</span>: 約戰資訊</div>
        {matchDetailId && <div>match_detail_id: <span className="font-mono">{matchDetailId}</span></div>}
        <div>團隊編號: <span className="font-mono">{teamId || '無'}</span></div>
        <div>團隊名稱: <span className="font-mono">{teamNameState || '未獲取'}</span></div>
        
        {/* 顯示現有約戰記錄 */}
        {matchDetailId && (
          <div className="mt-2 border-t pt-1">
            <div className="flex items-center">
              <span className="font-bold">現有約戰記錄:</span>
              {checkingRecords ? (
                <span className="ml-2 text-gray-500">檢查中...</span>
              ) : (
                <button 
                  onClick={checkExistingChallenges} 
                  className="ml-2 text-blue-500 text-xs underline"
                >
                  重新檢查
                </button>
              )}
            </div>
            {existingChallenges.length > 0 ? (
              <div className="mt-1 max-h-40 overflow-y-auto">
                {existingChallenges.map((challenge: Challenge, idx: number) => (
                  <div key={idx} className="pl-2 border-l-2 border-yellow-300 mt-1">
                    ID: {challenge.challenge_id}, 
                    發起人: {challenge.initiator}, 
                    日期: {challenge.challenge_date}
                  </div>
                ))}
                <div className="text-red-500 mt-1">
                  ⚠️ 注意: 點擊「{matchDetailId ? '戰書傳送' : '發起挑戰'}」將會刪除這些記錄
                </div>
              </div>
            ) : (
              <div className="pl-2 mt-1 text-green-600">
                {checkingRecords ? '檢查中...' : '未發現現有記錄'}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="mb-4">
        <h3 className="font-medium mb-2">參賽球員</h3>
        <div className="grid grid-cols-2 gap-2 w-full">
          {playerIds.length === 0 ? (
            <div className="col-span-2 text-red-500">無球員資料</div>
          ) : (
            playerIds.map((playerId, index) => (
              <div key={playerId} className="p-2 border rounded bg-gray-50 w-full text-center">
                {playerNames[index] || getMemberNameById(playerId)}
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
          {loading ? '提交中...' : matchDetailId ? '戰書傳送' : '發起挑戰'}
        </button>
      </div>
    </div>
  );
}