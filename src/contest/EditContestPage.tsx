import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useParams, useNavigate } from 'react-router-dom';

const EditContestPage: React.FC = () => {
  const { contest_id } = useParams<{ contest_id: string }>();
  const navigate = useNavigate();
  
  const [contestName, setContestName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [courtList, setCourtList] = useState<{ name: string; team_id: string }[]>([]);
  const [signupEndDate, setSignupEndDate] = useState(getDefaultSignupEndDate());
  const [expectedTeams, setExpectedTeams] = useState(0);
  const [playersPerTeam, setPlayersPerTeam] = useState(0);
  const [userTeamName, setUserTeamName] = useState('');
  // 新增總點數和賽制設定
  const [totalPoints, setTotalPoints] = useState(5);
  const [pointsConfig, setPointsConfig] = useState<{ type: string; note: string }[]>(
    Array(5).fill(null).map(() => ({ type: '雙打', note: '' }))
  );
  // 新增賽制選擇狀態
  const [matchMode, setMatchMode] = useState<string>('round_robin');
  // 新增球桌數設置
  const [tableCount, setTableCount] = useState<number>(1);

  // 假設有user context
  const user = JSON.parse(localStorage.getItem('loginUser') || '{}');
  const memberId = user?.member_id || '';
  const defaultTeamId = memberId ? memberId[0] : '';

  // 預設比賽規則內容
  const defaultRuleText = `參賽對象: 不限\n賽制: 5點雙打`;

  // 將 ruleText, setRuleText 的 useState 宣告移到這裡，只保留一份
  const [ruleText, setRuleText] = useState(defaultRuleText);

  // 當總點數變更時，更新 pointsConfig 陣列
  useEffect(() => {
    // 保留現有設定，只增減陣列長度
    const newConfig = [...pointsConfig];
    if (newConfig.length < totalPoints) {
      // 需要增加項目
      while (newConfig.length < totalPoints) {
        newConfig.push({ type: '雙打', note: '' });
      }
    } else if (newConfig.length > totalPoints) {
      // 需要減少項目
      newConfig.splice(totalPoints);
    }
    setPointsConfig(newConfig);
  }, [totalPoints]);

  // 取得 courts 資料並設定預設球場
  useEffect(() => {
    const fetchCourts = async () => {
      const { data, error } = await supabase.from('courts').select('name, team_id');
      if (error) {
        setErrorMsg('無法取得球場資料');
        return;
      }
      setCourtList(data || []);
    };
    fetchCourts();
  }, []);

  useEffect(() => {
    const fetchTeamName = async () => {
      if (user?.team_id) {
        const { data } = await supabase
          .from('courts')
          .select('name')
          .eq('team_id', user.team_id)
          .maybeSingle();
        setUserTeamName(data?.name || user.team_id);
      }
    };
    fetchTeamName();
  }, [user?.team_id]);

  // 載入比賽資料
  useEffect(() => {
    const fetchContestData = async () => {
      if (!contest_id) return;
      
      setInitialLoading(true);
      const { data, error } = await supabase
        .from('contest')
        .select('*')
        .eq('contest_id', contest_id)
        .single();
      
      if (error) {
        setErrorMsg('無法取得比賽資料: ' + error.message);
        setInitialLoading(false);
        return;
      }
      
      if (data) {
        setContestName(data.contest_name || '');
        setTeamName(data.team_name || '');
        setRuleText(data.rule_text || defaultRuleText);
        setSignupEndDate(data.signup_end_date || getDefaultSignupEndDate());
        setExpectedTeams(data.expected_teams || 0);
        setPlayersPerTeam(data.players_per_team || 0);
        
        // 設定賽制設定
        if (data.total_points) {
          setTotalPoints(data.total_points);
        }
        
        if (data.points_config) {
          try {
            const config = Array.isArray(data.points_config) 
              ? data.points_config 
              : JSON.parse(data.points_config);
            setPointsConfig(config);
          } catch (e) {
            console.error('解析賽制設定失敗:', e);
          }
        }
        
        // 設定賽制類型
        if (data.match_mode) {
          setMatchMode(data.match_mode);
        }
        
        // 設定球桌數
        if (data.table_count) {
          setTableCount(data.table_count);
        }
      }
      
      setInitialLoading(false);
    };
    
    fetchContestData();
  }, [contest_id]);

  // 預設報名結束日為今天+10天
  function getDefaultSignupEndDate() {
    const d = new Date();
    d.setDate(d.getDate() + 10);
    return d.toISOString().slice(0, 10);
  }

  // 更新點數設定的函數
  const updatePointConfig = (index: number, field: 'type' | 'note', value: string) => {
    const newConfig = [...pointsConfig];
    newConfig[index] = { ...newConfig[index], [field]: value };
    setPointsConfig(newConfig);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setSuccess(false);
    
    const { error } = await supabase
      .from('contest')
      .update({
        contest_name: contestName,
        team_name: teamName,
        rule_text: ruleText,
        signup_end_date: signupEndDate,
        expected_teams: expectedTeams,
        players_per_team: playersPerTeam,
        // 新增總點數和賽制設定
        total_points: totalPoints,
        points_config: pointsConfig,
        // 新增賽制類型
        match_mode: matchMode,
        // 新增球桌數
        table_count: tableCount
      })
      .eq('contest_id', contest_id);
    
    setLoading(false);
    if (error) {
      setErrorMsg(error.message);
    } else {
      setSuccess(true);
      // 顯示成功訊息，但不重置表單
      setTimeout(() => {
        navigate('/contests');
      }, 2000);
    }
  };

  if (initialLoading) {
    return (
      <div className="max-w-xl mx-auto mt-8 p-6 bg-white rounded shadow">
        <h2 className="text-2xl font-bold mb-4">載入比賽資料中...</h2>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto mt-8 p-6 bg-white rounded shadow">
      {/* 登入者資訊顯示區塊 */}
      <div className="mb-6 p-3 bg-gray-50 border border-gray-200 rounded">
        <div className="font-medium mb-1">登入者資訊</div>
        <div className="text-sm text-gray-700">
          <span>姓名：{user?.name || '未知'}</span><br />
          <span>團隊：{userTeamName}隊</span>
        </div>
      </div>
      <h2 className="text-2xl font-bold mb-4">編輯比賽</h2>
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label className="block font-medium mb-1">比賽名稱</label>
          <input
            type="text"
            className="w-full border rounded px-3 py-2"
            value={contestName}
            onChange={e => setContestName(e.target.value)}
            required
          />
        </div>
        <div className="mb-4">
          <label className="block font-medium mb-1">球場名稱</label>
          <select
            className="w-full border rounded px-3 py-2"
            value={teamName}
            onChange={e => setTeamName(e.target.value)}
            required
          >
            <option value="">請選擇球場</option>
            {courtList.map(court => (
              <option key={court.team_id} value={court.name}>{court.name}</option>
            ))}
          </select>
        </div>
        <div className="mb-4">
          <label className="block font-medium mb-1">比賽規則</label>
          <textarea
            className="w-full border rounded px-3 py-2 min-h-[80px]"
            value={ruleText}
            onChange={e => setRuleText(e.target.value)}
            required
          />
        </div>
        <div className="mb-4">
          <label className="block font-medium mb-1">報名結束日</label>
          <input
            type="date"
            className="w-full border rounded px-3 py-2"
            value={signupEndDate}
            onChange={e => setSignupEndDate(e.target.value)}
            required
          />
        </div>
        <div className="mb-4">
          <label className="block font-medium mb-1">預計隊數</label>
          <input
            type="number"
            min="1"
            className="w-full border rounded px-3 py-2"
            value={expectedTeams}
            onChange={e => setExpectedTeams(Number(e.target.value))}
            required
          />
        </div>
        <div className="mb-4">
          <label className="block font-medium mb-1">每隊人數</label>
          <input
            type="number"
            min="1"
            className="w-full border rounded px-3 py-2"
            value={playersPerTeam}
            onChange={e => setPlayersPerTeam(Number(e.target.value))}
            required
          />
        </div>
        
        {/* 新增賽制選擇 */}
        <div className="mb-4">
          <label className="block font-medium mb-1">賽制類型</label>
          <div className="flex gap-4">
            <label className="inline-flex items-center">
              <input
                type="radio"
                className="form-radio h-5 w-5 text-blue-600"
                name="matchMode"
                value="round_robin"
                checked={matchMode === 'round_robin'}
                onChange={() => setMatchMode('round_robin')}
              />
              <span className="ml-2">循環賽</span>
              <span className="ml-1 text-xs text-gray-500">(每隊都與其他隊伍對戰)</span>
            </label>
            <label className="inline-flex items-center">
              <input
                type="radio"
                className="form-radio h-5 w-5 text-blue-600"
                name="matchMode"
                value="elimination"
                checked={matchMode === 'elimination'}
                onChange={() => setMatchMode('elimination')}
              />
              <span className="ml-2">淘汰賽</span>
              <span className="ml-1 text-xs text-gray-500">(輸了就淘汰)</span>
            </label>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {matchMode === 'round_robin' 
              ? `循環賽：每隊都會與其他所有隊伍對戰一次，適合隊伍數量較少的比賽。` 
              : `淘汰賽：輸一場就淘汰，勝者晉級下一輪，適合隊伍數量較多的比賽。`}
          </p>
        </div>
        
        {/* 新增球桌數設置 */}
        <div className="mb-4">
          <label className="block font-medium mb-1">比賽球桌數</label>
          <input
            type="number"
            min="1"
            className="w-full border rounded px-3 py-2"
            value={tableCount}
            onChange={e => setTableCount(Number(e.target.value))}
            required
          />
          <p className="text-sm text-gray-500 mt-1">設定本場比賽可用的球桌數量，預設為1</p>
        </div>
        
        {/* 總點數欄位 */}
        <div className="mb-4">
          <label className="block font-medium mb-1">總點數</label>
          <input
            type="number"
            min="1"
            max="10"
            className="w-full border rounded px-3 py-2"
            value={totalPoints}
            onChange={e => setTotalPoints(Number(e.target.value))}
            required
          />
          <p className="text-sm text-gray-500 mt-1">設定本場比賽總共要比幾點（幾場）</p>
        </div>
        
        {/* 每點賽制設定 */}
        <div className="mb-6">
          <label className="block font-medium mb-2">每點賽制設定</label>
          <div className="bg-gray-50 p-3 rounded border border-gray-200">
            {pointsConfig.map((point, index) => (
              <div key={index} className="mb-2 pb-2 border-b border-gray-200 last:border-0 last:mb-0 last:pb-0">
                <div className="flex items-center mb-1">
                  <span className="font-medium text-gray-700 w-16">第 {index + 1} 點：</span>
                  <select
                    className="border rounded px-2 py-1 mr-2"
                    value={point.type}
                    onChange={e => updatePointConfig(index, 'type', e.target.value)}
                  >
                    <option value="單打">單打</option>
                    <option value="雙打">雙打</option>
                  </select>
                  <input
                    type="text"
                    placeholder="備註（可選）"
                    className="border rounded px-2 py-1 flex-1"
                    value={point.note}
                    onChange={e => updatePointConfig(index, 'note', e.target.value)}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="text-sm text-gray-500 mt-1">設定每一點的賽制類型，以便隊長安排人員</p>
        </div>
        
        <div className="flex space-x-4">
          <button
            type="button"
            onClick={() => navigate('/contests')}
            className="bg-gray-500 hover:bg-gray-600 text-white px-6 py-2 rounded"
          >
            取消
          </button>
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded"
            disabled={loading}
          >
            {loading ? '儲存中...' : '儲存變更'}
          </button>
        </div>
        {success && <div className="text-green-600 mt-3">比賽修改成功！即將返回列表...</div>}
        {errorMsg && <div className="text-red-600 mt-3">{errorMsg}</div>}
      </form>
    </div>
  );
};

export default EditContestPage;
