import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const CreateContestPage: React.FC = () => {
  const [contestName, setContestName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [loading, setLoading] = useState(false);
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
      // 找到預設 team_id 對應的球場
      if (data && defaultTeamId) {
        const found = data.find((c: any) => c.team_id === defaultTeamId);
        if (found) setTeamName(found.name);
      }
    };
    fetchCourts();
  }, [defaultTeamId]);

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
    const { error } = await supabase.from('contest').insert({
      contest_name: contestName,
      created_by: user.name,
      team_name: teamName,
      rule_text: ruleText,
      signup_end_date: signupEndDate,
      expected_teams: expectedTeams,
      players_per_team: playersPerTeam,
      contest_status: 'recruiting',
      // 新增總點數和賽制設定
      total_points: totalPoints,
      points_config: pointsConfig,
      // 新增賽制類型
      match_mode: matchMode,
      // 新增球桌數
      table_count: tableCount
    });
    setLoading(false);
    if (error) {
      setErrorMsg(error.message);
    } else {
      setSuccess(true);
      setContestName('');
      setTeamName('');
      setRuleText(defaultRuleText);
      setSignupEndDate(getDefaultSignupEndDate());
      setExpectedTeams(0);
      setPlayersPerTeam(0);
      // 重置總點數和賽制設定
      setTotalPoints(5);
      setPointsConfig(Array(5).fill(null).map(() => ({ type: '雙打', note: '' })));
      // 重置賽制選擇
      setMatchMode('round_robin');
      // 重置球桌數
      setTableCount(1);
    }
  };

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
      <h2 className="text-2xl font-bold mb-4">建立比賽</h2>
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
        
        {/* 新增總點數欄位 */}
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
        
        {/* 新增每點賽制設定 */}
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
        
        <button
          type="submit"
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded"
          disabled={loading}
        >
          {loading ? '建立中...' : '建立比賽'}
        </button>
        {success && <div className="text-green-600 mt-3">比賽建立成功！</div>}
        {errorMsg && <div className="text-red-600 mt-3">{errorMsg}</div>}
      </form>
    </div>
  );
};

export default CreateContestPage;
