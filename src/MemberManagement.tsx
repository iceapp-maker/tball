import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from './supabaseClient';

// 會員資料介面
interface Member {
  id: string;
  member_id: string;
  name: string;
  phone: string;
  join_date: string;
  remark: string;
  grade: number | null;
  role: string;
  team_id: string;
  password_hash?: string | null;
}

// loginUser 介面
interface LoginUser {
  role: string;
  name?: string;
  team_id?: string;
  [key: string]: any;
}

// 批量新增會員介面
interface BatchMember {
  name: string;
  phone: string;
  join_date: string;
  remark: string;
  grade: string;
  member_id: string;
  nameWarning?: string;
  nameSuggestion?: string;
}

// ========== 姓名唯一性檢查函數 ==========
const checkNameUniqueness = async (name: string, team_id: string, excludeId: string | null = null) => {
  if (!name || !team_id) {
    console.error('checkNameUniqueness: 缺少必要參數');
    return { isUnique: true, suggestedName: name };
  }
  
  try {
    let query = supabase
      .from('members')
      .select('name, id')
      .eq('team_id', team_id)
      .eq('name', name.trim()); // 確保姓名去除空白
      
    if (excludeId) {
      query = query.neq('id', excludeId);
    }
    
    const { data: existingMembers, error } = await query;
    
    if (error) {
      console.error('檢查姓名失敗:', error);
      // 當檢查失敗時，為了安全起見返回不唯一，但提供原名作為建議
      throw new Error(`姓名檢查失敗: ${error.message}`);
    }
    
    const isUnique = !existingMembers || existingMembers.length === 0;
    
    if (!isUnique) {
      const suggestedName = await generateNumberSuffix(name, team_id, excludeId);
      return { 
        isUnique: false, 
        suggestedName
      };
    }
    
    return { isUnique: true, suggestedName: name };
  } catch (error) {
    console.error('checkNameUniqueness 發生錯誤:', error);
    throw error; // 重新拋出錯誤讓上層處理
  }
};

// ========== 生成數字後綴建議 ==========
const generateNumberSuffix = async (originalName: string, team_id: string, excludeId: string | null = null) => {
  let query = supabase
    .from('members')
    .select('name')
    .eq('team_id', team_id)
    .like('name', `${originalName}%`);
    
  if (excludeId) {
    query = query.neq('id', excludeId);
  }
  
  const { data: similarNames, error } = await query;
  
  if (error) {
    return `${originalName}2`;
  }
  
  const existingNumbers = new Set<number>();
  const namePattern = new RegExp(`^${originalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)?$`);
  
  similarNames?.forEach(member => {
    const match = member.name.match(namePattern);
    if (match) {
      const number = match[1] ? parseInt(match[1], 10) : 1;
      if (!isNaN(number)) {
        existingNumbers.add(number);
      }
    }
  });
  
  let nextNumber = 2;
  while (existingNumbers.has(nextNumber)) {
    nextNumber++;
  }
  
  return `${originalName}${nextNumber}`;
};

// ========== 批量新增會員表單 ==========
const BatchAddMemberForm: React.FC<{ onSuccess: () => void; onCancel: () => void; loginUser: LoginUser }> = ({ onSuccess, onCancel, loginUser }) => {
  const [members, setMembers] = useState<BatchMember[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // 修正：加入 team_id 驗證和錯誤處理
  const team_id = loginUser?.team_id;
  
  // 加入團隊ID驗證
  useEffect(() => {
    if (!team_id) {
      alert('錯誤：無法取得團隊ID，請重新登入');
      onCancel();
      return;
    }
    console.log('批量新增會員 - 使用團隊ID:', team_id);
  }, [team_id, onCancel]);
  
  const todayStr = new Date().toISOString().slice(0, 10);
  const [nextMemberIdBase, setNextMemberIdBase] = useState(0);

  // 初始化：獲取下一個會員編號基礎
  useEffect(() => {
    const fetchNextMemberIdBase = async () => {
      if (!team_id) return;
      
      console.log('查詢會員編號，團隊ID:', team_id);
      
      const { data, error } = await supabase
        .from('members')
        .select('member_id')
        .like('member_id', `${team_id}%`);
        
      if (error) {
        console.error('查詢會員編號失敗:', error);
        setNextMemberIdBase(1);
        return;
      }
      
      console.log('現有會員編號:', data);
      
      let maxNum = 0;
      if (data && data.length > 0) {
        data.forEach((row: { member_id: string }) => {
          const numPart = row.member_id?.slice(team_id.length);
          const num = parseInt(numPart, 10);
          if (!isNaN(num) && num > maxNum) maxNum = num;
        });
      }
      
      console.log('下一個會員編號基礎:', maxNum + 1);
      setNextMemberIdBase(maxNum + 1);
    };
    
    fetchNextMemberIdBase();
  }, [team_id]);

  // 初始化一個空白會員
  useEffect(() => {
    if (nextMemberIdBase > 0 && team_id) {
      setMembers([{
        name: '',
        phone: '',
        join_date: todayStr,
        remark: '',
        grade: '',
        member_id: `${team_id}${(nextMemberIdBase).toString().padStart(4, '0')}`
      }]);
    }
  }, [nextMemberIdBase, team_id, todayStr]);

  // 更新會員編號
  const updateMemberIds = (membersList: BatchMember[]) => {
    if (!team_id) return membersList;
    
    return membersList.map((member, index) => ({
      ...member,
      member_id: `${team_id}${(nextMemberIdBase + index).toString().padStart(4, '0')}`
    }));
  };

  // 處理姓名貼上
  const handleNamePaste = async (index: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
    const names = pastedText.split(/\r?\n/).filter(name => name.trim() !== '');
    
    console.log('貼上的姓名：', names);
    
    if (names.length === 0) {
      return;
    }
    
    if (names.length === 1) {
      // 單個姓名，正常處理
      updateMember(index, 'name', names[0].trim());
      return;
    }
    
    // 多個姓名處理
    console.log('處理多個姓名，數量：', names.length);
    
    // 使用函數式更新
    setMembers((currentMembers: BatchMember[]) => {
      if (!currentMembers || !Array.isArray(currentMembers)) {
        console.log('currentMembers 狀態異常');
        return currentMembers;
      }
      
      const newMembers = [...currentMembers];
      
      // 更新當前行
      if (index >= 0 && index < newMembers.length) {
        newMembers[index] = { 
          ...newMembers[index], 
          name: names[0].trim() 
        };
      }
      
      // 添加額外的行
      for (let i = 1; i < names.length; i++) {
        newMembers.push({
          name: names[i].trim(),
          phone: '',
          join_date: todayStr,
          remark: '',
          grade: '',
          member_id: ''
        });
      }
      
      // 立即更新會員編號
      return updateMemberIds(newMembers);
    });
    
    // 延遲檢查姓名唯一性，給狀態更新時間
    setTimeout(() => {
      for (let i = 0; i < names.length; i++) {
        if (names[i].trim()) {
          checkMemberName(index + i, names[i].trim());
        }
      }
    }, 300);
  };

  // 更新單個會員資料
  const updateMember = (index: number, field: string, value: string) => {
    const updatedMembers = [...members];
    updatedMembers[index] = { ...updatedMembers[index], [field]: value };
    setMembers(updatedMembers);
    
    // 如果是姓名欄位，檢查唯一性
    if (field === 'name' && value.trim()) {
      checkMemberName(index, value);
    }
  };

  // 檢查姓名唯一性
  const checkMemberName = async (index: number, name: string) => {
    if (!team_id || !name.trim()) return;
    
    // 防護：確保 members 存在且是陣列
    if (!members || !Array.isArray(members)) {
      console.log('members 狀態異常，跳過檢查');
      return;
    }
    
    try {
      // 檢查與資料庫的重複
      const { isUnique, suggestedName } = await checkNameUniqueness(name, team_id);
      
      // 檢查與同批次的重複 - 改進版本
      const currentBatchNames = members.filter((m: BatchMember, i: number) => 
        i !== index && 
        m && 
        typeof m.name === 'string' && 
        m.name.trim().toLowerCase() === name.trim().toLowerCase() // 加入大小寫不敏感比較
      );
      const hasBatchDuplicate = currentBatchNames.length > 0;
      
      // 使用函數式更新來避免狀態競爭
      setMembers((currentMembers: BatchMember[]) => {
        if (!currentMembers || !Array.isArray(currentMembers)) {
          console.log('currentMembers 狀態異常');
          return currentMembers;
        }
        
        const updatedMembers = [...currentMembers];
        
        // 確保索引有效
        if (index >= 0 && index < updatedMembers.length) {
          if (!isUnique || hasBatchDuplicate) {
            updatedMembers[index] = {
              ...updatedMembers[index],
              nameWarning: hasBatchDuplicate ? '同批次中有重複姓名' : '此姓名已存在',
              nameSuggestion: suggestedName
            };
          } else {
            // 清除警告
            const { nameWarning, nameSuggestion, ...cleanMember } = updatedMembers[index];
            updatedMembers[index] = cleanMember;
          }
        }
        
        return updatedMembers;
      });
    } catch (error) {
      console.error('檢查姓名時發生錯誤:', error);
    }
  };

  // 採用建議姓名
  const adoptSuggestedName = (index: number) => {
    const updatedMembers = [...members];
    updatedMembers[index].name = updatedMembers[index].nameSuggestion || '';
    delete updatedMembers[index].nameWarning;
    delete updatedMembers[index].nameSuggestion;
    setMembers(updatedMembers);
  };

  // 新增行
  const addRow = () => {
    const newMember: BatchMember = {
      name: '',
      phone: '',
      join_date: todayStr,
      remark: '',
      grade: '',
      member_id: ''
    };
    const newMembers = [...members, newMember];
    setMembers(updateMemberIds(newMembers));
  };

  // 刪除行
  const removeRow = (index: number) => {
    if (members.length <= 1) return;
    const newMembers = members.filter((_, i) => i !== index);
    setMembers(updateMemberIds(newMembers));
  };

  // 提交批量新增
  const handleSubmit = async () => {
    if (!team_id) {
      alert('錯誤：無法取得團隊ID，請重新登入');
      return;
    }

    console.log('開始批量新增，團隊ID:', team_id);

    // 驗證所有必填欄位
    const invalidMembers = members.filter(member => !member.name.trim());
    if (invalidMembers.length > 0) {
      alert('請填寫所有會員的姓名');
      return;
    }

    setIsSubmitting(true);

    try {
      // 🚀 修復：最終提交前重新檢查所有姓名
      console.log('正在進行最終姓名檢查...');
      const nameCheckPromises = members.map(async (member, index) => {
        const memberName = member.name.trim();
        
        // 檢查與資料庫的重複
        const { isUnique } = await checkNameUniqueness(memberName, team_id);
        
        // 檢查與同批次的重複
        const batchDuplicates = members.filter((m, i) => 
          i !== index && m.name.trim() === memberName
        );
        
        return {
          index,
          name: memberName,
          isUnique,
          hasBatchDuplicate: batchDuplicates.length > 0,
          batchDuplicateIndices: members
            .map((m, i) => i !== index && m.name.trim() === memberName ? i : -1)
            .filter(i => i !== -1)
        };
      });

      const nameCheckResults = await Promise.all(nameCheckPromises);
      
      // 檢查是否有重複
      const duplicateResults = nameCheckResults.filter(
        result => !result.isUnique || result.hasBatchDuplicate
      );
      
      if (duplicateResults.length > 0) {
        console.error('發現重複姓名:', duplicateResults);
        
        let errorMessage = '發現以下姓名重複，請修改後再提交：\n\n';
        duplicateResults.forEach(result => {
          if (!result.isUnique) {
            errorMessage += `• "${result.name}" 在資料庫中已存在\n`;
          }
          if (result.hasBatchDuplicate) {
            errorMessage += `• "${result.name}" 在此批次中重複（行 ${result.index + 1}`;
            if (result.batchDuplicateIndices.length > 0) {
              errorMessage += ` 和行 ${result.batchDuplicateIndices.map(i => i + 1).join(', ')}`;
            }
            errorMessage += '）\n';
          }
        });
        
        alert(errorMessage);
        
        // 更新 UI 顯示錯誤狀態
        setMembers(currentMembers => {
          const updatedMembers = [...currentMembers];
          duplicateResults.forEach(result => {
            if (result.index < updatedMembers.length) {
              updatedMembers[result.index] = {
                ...updatedMembers[result.index],
                nameWarning: !result.isUnique ? '此姓名已存在' : '同批次中有重複姓名'
              };
            }
          });
          return updatedMembers;
        });
        
        return; // 阻止提交
      }

      console.log('姓名檢查通過，開始插入資料');

      // 準備插入資料
      const insertData = members.map(member => {
        const data: any = {
          member_id: member.member_id,
          name: member.name.trim(),
          phone: member.phone.trim() || null,
          join_date: member.join_date,
          remark: member.remark.trim() || null,
          role: 'member',
          team_id: team_id,
          password_hash: null
        };

        // 處理級數
        if (member.grade === '' || member.grade === null || member.grade === undefined) {
          data.grade = null;
        } else {
          const gradeNum = parseInt(member.grade.toString(), 10);
          if (isNaN(gradeNum)) {
            throw new Error(`會員 ${member.name} 的級數必須是數字`);
          }
          data.grade = gradeNum;
        }

        return data;
      });

      console.log('準備批量插入的資料:', insertData);

      const { data, error } = await supabase
        .from('members')
        .insert(insertData)
        .select();

      if (error) {
        console.error('Supabase 錯誤:', error);
        alert(`批量新增失敗: ${error.message}`);
      } else {
        console.log('批量插入成功:', data);
        alert(`成功新增 ${members.length} 位會員！`);
        onSuccess();
      }
    } catch (err: any) {
      console.error('JavaScript 錯誤:', err);
      alert(err.message || '發生未預期的錯誤');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 如果沒有 team_id，不渲染表單
  if (!team_id) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
        <div className="bg-white p-6 rounded shadow-md">
          <h2 className="text-lg font-bold mb-4">錯誤</h2>
          <p>無法取得團隊ID，請重新登入</p>
          <button onClick={onCancel} className="mt-4 px-4 py-2 bg-gray-300 rounded">
            關閉
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded shadow-md w-full max-w-6xl h-5/6 flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">批量新增會員</h2>
          <div className="text-sm text-gray-600">
            團隊ID: {team_id} | 準備新增：{members.length} 位會員
          </div>
        </div>
        
        <div className="text-sm text-blue-600 mb-4 p-2 bg-blue-50 border border-blue-200 rounded">
          💡 提示：在姓名欄位可以貼上多個姓名（每行一個），系統會自動展開為多列
        </div>

        <div className="flex-1 overflow-auto border rounded">
          <table className="min-w-full table-fixed">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="w-24 px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">會員編號</th>
                <th className="w-32 px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">姓名 *</th>
                <th className="w-32 px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">電話</th>
                <th className="w-24 px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">級數</th>
                <th className="w-28 px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">加入日期</th>
                <th className="flex-1 px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">備註</th>
                <th className="w-20 px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {members.map((member, index) => (
                <React.Fragment key={index}>
                  <tr>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        value={member.member_id}
                        readOnly
                        className="w-full p-1 text-xs border rounded bg-gray-100"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        value={member.name}
                        onChange={e => updateMember(index, 'name', e.target.value)}
                        onPaste={e => handleNamePaste(index, e)}
                        placeholder="可貼上多個姓名"
                        className="w-full p-1 text-xs border rounded"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        value={member.phone}
                        onChange={e => updateMember(index, 'phone', e.target.value)}
                        className="w-full p-1 text-xs border rounded"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        value={member.grade}
                        onChange={e => {
                          const value = e.target.value;
                          if (value === '' || /^\d+$/.test(value)) {
                            updateMember(index, 'grade', value);
                          }
                        }}
                        placeholder="數字"
                        className="w-full p-1 text-xs border rounded"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="date"
                        value={member.join_date}
                        onChange={e => updateMember(index, 'join_date', e.target.value)}
                        className="w-full p-1 text-xs border rounded"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        value={member.remark}
                        onChange={e => updateMember(index, 'remark', e.target.value)}
                        className="w-full p-1 text-xs border rounded"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => removeRow(index)}
                        disabled={members.length <= 1}
                        className="text-red-600 hover:text-red-800 disabled:text-gray-400 text-xs"
                      >
                        刪除
                      </button>
                    </td>
                  </tr>
                  {member.nameWarning && (
                    <tr>
                      <td colSpan={7} className="px-2 py-1">
                        <div className="text-xs bg-yellow-50 border border-yellow-200 rounded p-2">
                          <div className="text-yellow-800">{member.nameWarning}</div>
                          {member.nameSuggestion && (
                            <div className="mt-1 flex items-center gap-2">
                              <span className="text-gray-600">建議使用：</span>
                              <code className="bg-gray-100 px-1 rounded text-xs">{member.nameSuggestion}</code>
                              <button
                                type="button"
                                onClick={() => adoptSuggestedName(index)}
                                className="text-blue-600 hover:text-blue-800 text-xs underline"
                              >
                                採用
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex justify-between items-center">
          <button
            type="button"
            onClick={addRow}
            className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 text-sm"
          >
            + 新增一行
          </button>
          
          <div className="flex gap-2">
            <button 
              type="button" 
              onClick={onCancel} 
              className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400"
              disabled={isSubmitting}
            >
              取消
            </button>
            <button 
              type="button"
              onClick={handleSubmit} 
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400"
              disabled={isSubmitting}
            >
              {isSubmitting ? '新增中...' : `新增 ${members.length} 位會員`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ========== 單個新增會員表單 ==========
const AddMemberForm: React.FC<{ onSuccess: () => void; onCancel: () => void; loginUser: LoginUser }> = ({ onSuccess, onCancel, loginUser }) => {
  const [member_id, setMemberId] = useState('系統自動產生');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const todayStr = new Date().toISOString().slice(0, 10);
  const [join_date, setJoinDate] = useState(todayStr);
  const [remark, setRemark] = useState('');
  const [grade, setGrade] = useState('');
  
  // 修正：加入 team_id 驗證和錯誤處理
  const team_id = loginUser?.team_id;
  
  const [nameCheckTimeout, setNameCheckTimeout] = useState<NodeJS.Timeout | null>(null);
  const [nameSuggestion, setNameSuggestion] = useState('');
  const [showNameWarning, setShowNameWarning] = useState(false);

  // 加入團隊ID驗證
  useEffect(() => {
    if (!team_id) {
      alert('錯誤：無法取得團隊ID，請重新登入');
      onCancel();
      return;
    }
    console.log('單個新增會員 - 使用團隊ID:', team_id);
  }, [team_id, onCancel]);

  useEffect(() => {
    const fetchNextMemberId = async () => {
      if (!team_id) {
        setMemberId('無團隊');
        return;
      }
      
      console.log('查詢會員編號，團隊ID:', team_id);
      
      const { data, error } = await supabase
        .from('members')
        .select('member_id')
        .like('member_id', `${team_id}%`);
        
      if (error) {
        console.error('查詢會員編號失敗:', error);
        setMemberId(`${team_id}0001`);
        return;
      }
      
      console.log('現有會員編號:', data);
      
      let maxNum = 0;
      if (data && data.length > 0) {
        data.forEach((row: { member_id: string }) => {
          const numPart = row.member_id?.slice(team_id.length);
          const num = parseInt(numPart, 10);
          if (!isNaN(num) && num > maxNum) maxNum = num;
        });
      }
      const nextNum = (maxNum + 1).toString().padStart(4, '0');
      const nextMemberId = `${team_id}${nextNum}`;
      
      console.log('下一個會員編號:', nextMemberId);
      setMemberId(nextMemberId);
    };
    fetchNextMemberId();
  }, [team_id]);

  const handleNameChange = async (newName: string) => {
    setName(newName);
    
    if (nameCheckTimeout) {
      clearTimeout(nameCheckTimeout);
    }
    
    const timeoutId = setTimeout(async () => {
      if (newName.trim().length > 0 && team_id) {
        const { isUnique, suggestedName } = await checkNameUniqueness(newName, team_id);
        if (!isUnique) {
          setNameSuggestion(suggestedName);
          setShowNameWarning(true);
        } else {
          setShowNameWarning(false);
          setNameSuggestion('');
        }
      }
    }, 500);
    
    setNameCheckTimeout(timeoutId);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // 修正：強化 team_id 驗證
    if (!team_id) {
      alert('錯誤：無法取得團隊ID，請重新登入');
      return;
    }
    
    console.log('開始新增會員，團隊ID:', team_id);
    
    const { isUnique } = await checkNameUniqueness(name, team_id);
    
    if (!isUnique) {
      alert('此姓名已存在，請修改後再提交');
      return;
    }
    
    const insertData: any = {
      member_id,
      name: name.trim(),
      phone: phone.trim() || null,
      join_date,
      remark: remark.trim() || null,
      role: 'member',
      team_id: team_id, // 修正：確保使用正確的 team_id
      password_hash: null // 首次登入狀態
    };

    if (grade === '' || grade === null || grade === undefined) {
      insertData.grade = null;
    } else {
      const gradeNum = parseInt(grade.toString(), 10);
      if (isNaN(gradeNum)) {
        alert('級數必須是數字');
        return;
      }
      insertData.grade = gradeNum;
    }

    console.log('準備插入的資料:', insertData);

    const { error } = await supabase
      .from('members')
      .insert([insertData])
      .select();
    
    if (error) {
      console.error('更新失敗:', error);
      alert('更新失敗: ' + error.message);
    } else {
      console.log('會員新增成功');
      onSuccess();
    }
  };

  // 如果沒有 team_id，不渲染表單
  if (!team_id) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
        <div className="bg-white p-6 rounded shadow-md">
          <h2 className="text-lg font-bold mb-4">錯誤</h2>
          <p>無法取得團隊ID，請重新登入</p>
          <button onClick={onCancel} className="mt-4 px-4 py-2 bg-gray-300 rounded">
            關閉
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
      <form className="bg-white p-6 rounded shadow-md w-96" onSubmit={handleSubmit}>
        <h2 className="text-lg font-bold mb-4">新增會員</h2>
        <div className="mb-2 text-sm text-gray-600">
          團隊ID: {team_id}
        </div>
        <div>
          <label htmlFor="member_id">會員編號</label>
          <input
            id="member_id"
            type="text"
            value={member_id}
            disabled
            className="w-full mb-2 p-2 border rounded"
          />
        </div>
        <div>
          <label htmlFor="name">姓名</label>
          <>
            <input
              id="name"
              type="text"
              value={name}
              onChange={e => handleNameChange(e.target.value)}
              required
              className="w-full mb-2 p-2 border rounded"
            />
            {showNameWarning && (
              <div className="mt-1 p-2 bg-yellow-50 border border-yellow-200 rounded">
                <div className="text-yellow-800 text-sm">此姓名已存在</div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-sm text-gray-600">建議使用：</span>
                  <code className="bg-gray-100 px-2 py-1 rounded text-sm">{nameSuggestion}</code>
                  <button
                    type="button"
                    onClick={() => {
                      setName(nameSuggestion);
                      setShowNameWarning(false);
                    }}
                    className="text-blue-600 hover:text-blue-800 text-sm underline"
                  >
                    採用
                  </button>
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  您也可以手動修改為任何其他名稱
                </div>
              </div>
            )}
          </>
        </div>
        <div>
          <label htmlFor="phone">電話</label>
          <input
            id="phone"
            type="text"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            className="w-full mb-2 p-2 border rounded"
          />
        </div>
        <div>
          <label htmlFor="join_date">加入日期</label>
          <input
            id="join_date"
            type="date"
            value={join_date}
            onChange={e => setJoinDate(e.target.value)}
            required
            className="w-full mb-2 p-2 border rounded"
          />
        </div>
        <div>
          <label htmlFor="grade">級數</label>
          <input
            id="grade"
            type="text"
            value={grade}
            onChange={e => {
              const value = e.target.value;
              if (value === '' || /^\d+$/.test(value)) {
                setGrade(value);
              }
            }}
            className="w-full mb-2 p-2 border rounded"
            placeholder="請輸入數字或留空"
          />
        </div>
        <div>
          <label htmlFor="remark">備註</label>
          <input
            id="remark"
            type="text"
            value={remark}
            onChange={e => setRemark(e.target.value)}
            className="w-full mb-2 p-2 border rounded"
          />
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-300 rounded">取消</button>
          <button type="submit" className="px-4 py-2 bg-blue-500 text-white rounded">新增</button>
        </div>
      </form>
    </div>
  );
};

// ========== 編輯會員表單（新增重置密碼功能） ==========
const EditMemberForm: React.FC<{ member: Member; onSuccess: () => void; onCancel: () => void }> = ({ member, onSuccess, onCancel }) => {
  // 安全工具函數
  const safeStringValue = (value: any): string => {
    if (value === null || value === undefined) {
      return '';
    }
    return value.toString();
  };

  const safeTrim = (value: any): string => {
    return safeStringValue(value).trim();
  };

  // 安全地初始化所有 state
  const [name, setName] = useState(safeStringValue(member.name));
  const [phone, setPhone] = useState(safeStringValue(member.phone));
  const [join_date, setJoinDate] = useState(safeStringValue(member.join_date));
  const [remark, setRemark] = useState(safeStringValue(member.remark));
  const [grade, setGrade] = useState(member.grade?.toString() || '');
  const [nameCheckTimeout, setNameCheckTimeout] = useState<NodeJS.Timeout | null>(null);
  const [nameSuggestion, setNameSuggestion] = useState('');
  const [showNameWarning, setShowNameWarning] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [gradeError, setGradeError] = useState('');

  // 級數驗證函數
  const validateGrade = (gradeValue: string) => {
    const trimmed = gradeValue.trim();
    
    // 允許空白
    if (trimmed === '') {
      setGradeError('');
      return { isValid: true, value: null };
    }
    
    // 檢查是否為正整數
    if (!/^\d+$/.test(trimmed)) {
      setGradeError('級數只能包含數字');
      return { isValid: false };
    }
    
    const num = parseInt(trimmed, 10);
    if (num < 0) {
      setGradeError('級數不能是負數');
      return { isValid: false };
    }
    
    if (num > 9999) {
      setGradeError('級數不能超過 9999');
      return { isValid: false };
    }
    
    setGradeError('');
    return { isValid: true, value: num };
  };

  // 處理姓名變更
  const handleNameChange = async (newName: string) => {
    const safeName = safeStringValue(newName);
    setName(safeName);
    
    if (nameCheckTimeout) {
      clearTimeout(nameCheckTimeout);
    }
    
    const timeoutId = setTimeout(async () => {
      if (safeName.trim().length > 0) {
        try {
          const { isUnique, suggestedName } = await checkNameUniqueness(safeName, member.team_id, member.id);
          if (!isUnique) {
            setNameSuggestion(suggestedName);
            setShowNameWarning(true);
          } else {
            setShowNameWarning(false);
            setNameSuggestion('');
          }
        } catch (error) {
          console.error('檢查姓名時發生錯誤:', error);
          if (error instanceof Error && 
              (error.message.includes('network') || error.message.includes('timeout'))) {
            console.warn('網路問題，跳過姓名檢查');
            return;
          }
          setShowNameWarning(false);
          setNameSuggestion('');
        }
      }
    }, 300);
    
    setNameCheckTimeout(timeoutId);
  };

  // 提交表單
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (isSubmitting) {
      console.log('正在提交中，忽略重複提交');
      return;
    }
    
    // 驗證級數
    const gradeValidation = validateGrade(grade);
    if (!gradeValidation.isValid) {
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      console.log('開始編輯會員提交流程');
      
      // 1. 姓名唯一性檢查 - 加強錯誤處理
      let nameCheckResult;
      try {
        const safeName = safeTrim(name);
        nameCheckResult = await checkNameUniqueness(safeName, member.team_id, member.id);
        console.log('姓名檢查結果:', nameCheckResult);
      } catch (error) {
        console.error('姓名唯一性檢查失敗:', error);
        alert('姓名檢查失敗，請稍後再試');
        return;
      }
      
      if (!nameCheckResult.isUnique) {
        alert('此姓名已存在，請修改後再提交');
        return;
      }
      
      // 2. 準備更新資料 - 使用安全函數處理所有值
      const updateData: any = {
        name: safeTrim(name),
        phone: safeTrim(phone) || null,
        join_date: safeStringValue(join_date),
        remark: safeTrim(remark) || null,
        grade: gradeValidation.value
      };

      console.log('準備更新的資料:', updateData);
      console.log('更新會員ID:', member.id);

      // 3. 執行資料庫更新
      const { data, error } = await supabase
        .from('members')
        .update(updateData)
        .eq('id', member.id)
        .select();

      if (error) {
        console.error('Supabase 更新失敗:', error);
        alert(`更新失敗: ${error.message}`);
        return;
      }

      if (!data || data.length === 0) {
        console.error('更新沒有影響任何記錄');
        alert('更新失敗：找不到指定的會員記錄');
        return;
      }

      console.log('更新成功:', data);
      alert('會員資料更新成功！');
      onSuccess();
      
    } catch (error: any) {
      console.error('提交過程中發生未預期錯誤:', error);
      alert(`發生錯誤: ${error.message || '未知錯誤'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 重置密碼函數
  const handleResetPassword = async () => {
    const confirmMessage = `確定要重置 ${member.name} 的密碼嗎？\n\n重置後該會員需要使用會員編號重新登入並設定新密碼。`;
    
    if (!window.confirm(confirmMessage)) {
      return;
    }

    setIsResettingPassword(true);

    try {
      const { error } = await supabase
        .from('members')
        .update({ 
          password_hash: null,
          must_change_password: true 
        })
        .eq('id', member.id);

      if (error) {
        console.error('重置密碼失敗:', error);
        alert('重置密碼失敗，請稍後再試！');
      } else {
        alert(`已重置 ${member.name} 的密碼！\n請通知該會員使用會員編號 ${member.member_id} 重新登入設定新密碼。`);
        onSuccess(); // 重新載入會員列表以更新密碼狀態
      }
    } catch (error) {
      console.error('重置密碼時發生錯誤:', error);
      alert('重置密碼時發生錯誤，請稍後再試！');
    } finally {
      setIsResettingPassword(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
      <form className="bg-white p-6 rounded shadow-md w-96 max-h-[90vh] overflow-y-auto" onSubmit={handleSubmit}>
        <h2 className="text-lg font-bold mb-4">編輯會員</h2>
        
        <div>
          <label htmlFor="member_id">會員編號</label>
          <input
            id="member_id"
            type="text"
            value={member.member_id}
            disabled
            className="w-full mb-2 p-2 border rounded bg-gray-100"
          />
        </div>
        
        <div>
          <label htmlFor="name">姓名</label>
          <>
            <input
              id="name"
              type="text"
              value={name}
              onChange={e => handleNameChange(e.target.value)}
              required
              className="w-full mb-2 p-2 border rounded"
            />
            {showNameWarning && (
              <div className="mt-1 p-2 bg-yellow-50 border border-yellow-200 rounded">
                <div className="text-yellow-800 text-sm">此姓名已存在</div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-sm text-gray-600">建議使用：</span>
                  <code className="bg-gray-100 px-2 py-1 rounded text-sm">{nameSuggestion}</code>
                  <button
                    type="button"
                    onClick={() => {
                      setName(nameSuggestion);
                      setShowNameWarning(false);
                    }}
                    className="text-blue-600 hover:text-blue-800 text-sm underline"
                  >
                    採用
                  </button>
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  您也可以手動修改為任何其他名稱
                </div>
              </div>
            )}
          </>
        </div>
        
        <div>
          <label htmlFor="phone">電話</label>
          <input
            id="phone"
            type="text"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            className="w-full mb-2 p-2 border rounded"
          />
        </div>
        
        <div>
          <label htmlFor="join_date">加入日期</label>
          <input
            id="join_date"
            type="date"
            value={join_date}
            onChange={e => setJoinDate(e.target.value)}
            required
            className="w-full mb-2 p-2 border rounded"
          />
        </div>
        
        <div>
          <label htmlFor="grade">級數</label>
          <input
            id="grade"
            type="text"
            value={grade}
            onChange={e => {
              const value = e.target.value;
              if (value === '' || /^\d+$/.test(value)) {
                setGrade(value);
              }
            }}
            className={`w-full mb-2 p-2 border rounded ${gradeError ? 'border-red-500' : ''}`}
            placeholder="請輸入數字或留空 (最大 9999)"
            maxLength={4}
          />
          {gradeError && (
            <div className="text-red-500 text-sm mb-2">{gradeError}</div>
          )}
        </div>
        
        <div>
          <label htmlFor="remark">備註</label>
          <input
            id="remark"
            type="text"
            value={remark}
            onChange={e => setRemark(e.target.value)}
            className="w-full mb-2 p-2 border rounded"
          />
        </div>

        {/* 密碼管理區塊 */}
        <div className="mt-4 pt-4 border-t border-gray-200">
          <h3 className="text-md font-semibold mb-3 flex items-center">
            🔐 密碼管理
          </h3>
          
          <div className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">目前狀態：</span>
              <span className={`px-2 py-1 rounded text-xs ${
                !member.password_hash ? 'bg-orange-100 text-orange-800' : 'bg-green-100 text-green-800'
              }`}>
                {!member.password_hash ? '待設定密碼' : '已設定密碼'}
              </span>
            </div>
            
            {member.password_hash && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={handleResetPassword}
                  disabled={isResettingPassword}
                  className="w-full px-3 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-sm"
                >
                  {isResettingPassword ? '重置中...' : '重置密碼'}
                </button>
                <p className="mt-1 text-xs text-gray-500">
                  重置後該會員需要重新登入設定新密碼
                </p>
              </div>
            )}
            
            {!member.password_hash && (
              <div className="mt-2">
                <p className="text-xs text-orange-600">
                  該會員尚未設定密碼，可使用會員編號登入後設定
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button 
            type="button" 
            onClick={onCancel} 
            className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400"
            disabled={isSubmitting}
          >
            取消
          </button>
          <button 
            type="submit" 
            className={`px-4 py-2 text-white rounded ${
              isSubmitting 
                ? 'bg-gray-400 cursor-not-allowed' 
                : 'bg-blue-500 hover:bg-blue-600'
            }`}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <span className="flex items-center">
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                儲存中...
              </span>
            ) : '儲存'}
          </button>
        </div>
      </form>
    </div>
  );
};

// ========== 主組件 ==========
const MemberManagement: React.FC<{ loginUser?: LoginUser | null }> = ({ loginUser }) => {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<LoginUser | null>(loginUser ?? null);

  useEffect(() => {
    if (!currentUser) {
      const user = localStorage.getItem('loginUser');
      if (user) {
        const parsed = JSON.parse(user);
        if (parsed && parsed.team_id) {
          setCurrentUser(parsed);
        }
      }
    }
  }, []);

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gray-100 p-6 flex justify-center items-center">
        <div className="bg-white p-8 rounded-lg shadow-md">
          <h2 className="text-xl font-bold mb-4">需要登入</h2>
          <p>您需要登入後才能訪問會員管理系統。</p>
          <Link to="/" className="mt-4 inline-block px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
            返回主選單
          </Link>
        </div>
      </div>
    );
  }

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showBatchAddForm, setShowBatchAddForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [currentMember, setCurrentMember] = useState<Member | null>(null);

  const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.role === 'team_admin');

  useEffect(() => {
    const fetchMembers = async () => {
      if (!currentUser || !currentUser.team_id) {
        setLoading(false);
        alert('登入者資訊異常，請確認帳號具有正確的團隊ID！');
        return;
      }
      setLoading(true);
      
      console.log('載入會員列表，團隊ID:', currentUser.team_id);
      
      // 加上按 member_id 排序
      const { data, error } = await supabase
        .from('members')
        .select('*')
        .eq('team_id', currentUser.team_id)
        .order('member_id', { ascending: true }); // 新增排序
        
      if (!error) {
        console.log('載入的會員資料:', data);
        setMembers(data || []);
      } else {
        console.error('載入會員失敗:', error);
        alert('會員資料載入失敗，請稍後再試！');
      }
      setLoading(false);
    };
    fetchMembers();
  }, [currentUser]);

  const handleDelete = async (id: string) => {
    if (!isAdmin) return;
    if (!window.confirm('確定要刪除此會員資料嗎？此操作無法撤銷。')) {
      return;
    }
    try {
      const { error } = await supabase.from('members').delete().eq('id', id);
      if (error) throw error;
      
      refreshMembers();
    } catch (error) {
      console.error('刪除會員失敗:', error);
      alert('刪除會員失敗，請稍後再試！');
    }
  };

  const handleEdit = (member: Member) => {
    if (!isAdmin) return;
    setCurrentMember(member);
    setShowEditForm(true);
  };

  const refreshMembers = async () => {
    if (!currentUser || !currentUser.team_id) return;
    setLoading(true);
    
    console.log('重新載入會員列表，團隊ID:', currentUser.team_id);
    
    // 加上按 member_id 排序
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .eq('team_id', currentUser.team_id)
      .order('member_id', { ascending: true }); // 新增排序
      
    if (error) {
      console.error('獲取會員失敗:', error);
      alert('獲取會員失敗，請稍後再試！');
    } else {
      console.log('重新載入的會員資料:', data);
      setMembers(data || []);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="w-full max-w-full sm:max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-2">
          <h1 className="text-2xl font-bold">會員管理系統</h1>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
            <span className="mr-0 sm:mr-4">當前用戶: {currentUser.name} | 團隊ID: {currentUser.team_id}</span>
            <Link to="/" className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 w-full sm:w-auto text-center">
              返回主選單
            </Link>
          </div>
        </div>

        {/* 顯示會員統計 */}
        <div className="mb-4 p-4 bg-white rounded-lg shadow-md">
          <div className="text-lg font-semibold text-gray-700">
            現有會員：{members.length} 人
          </div>
        </div>

        {isAdmin && (
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => setShowAddForm(true)}
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 w-full sm:w-auto"
            >
              新增會員
            </button>
            <button
              onClick={() => setShowBatchAddForm(true)}
              className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 w-full sm:w-auto"
            >
              批量新增會員
            </button>
          
          </div>
        )}

        {loading ? (
          <div className="text-center py-8">載入中...</div>
        ) : (
          <div className="bg-white shadow-md rounded-lg overflow-x-auto overflow-y-auto w-full max-h-[60vh]">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
                    會員編號
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    姓名
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16">
                    密碼狀態
                  </th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {members.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-gray-500">
                      沒有找到會員資料
                    </td>
                  </tr>
                ) : (
                  members.map((member) => (
                    <tr key={member.id} className="hover:bg-gray-50">
                      <td className="px-3 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {member.member_id}
                      </td>
                      <td className="px-3 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{member.name}</div>
                        <div className="text-xs text-gray-500">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            member.role === 'admin' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
                          }`}>
                            {member.role === 'admin' ? '管理員' : '會員'}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                          !member.password_hash ? 'bg-orange-100 text-orange-800' : 'bg-green-100 text-green-800'
                        }`}>
                          {!member.password_hash ? '待設定' : '已設定'}
                        </span>
                      </td>
                      <td className="px-3 py-4 whitespace-nowrap text-right text-sm">
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={() => isAdmin && handleEdit(member)}
                            className={`px-2 py-1 text-xs rounded ${
                              isAdmin
                                ? "bg-blue-500 text-white hover:bg-blue-600"
                                : "bg-gray-200 text-gray-400 cursor-not-allowed"
                            }`}
                            disabled={!isAdmin}
                            title={isAdmin ? "編輯會員詳細資料" : "只有管理員可以編輯"}
                          >
                            編輯
                          </button>
                          <button
                            onClick={() => isAdmin && handleDelete(member.id)}
                            className={`px-2 py-1 text-xs rounded ${
                              isAdmin
                                ? "bg-red-500 text-white hover:bg-red-600"
                                : "bg-gray-200 text-gray-400 cursor-not-allowed"
                            }`}
                            disabled={!isAdmin}
                            title={isAdmin ? "刪除會員" : "只有管理員可以刪除"}
                          >
                            刪除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 單個新增會員表單 */}
      {showAddForm && (
        <AddMemberForm
          onSuccess={() => {
            setShowAddForm(false);
            refreshMembers();
          }}
          onCancel={() => setShowAddForm(false)}
          loginUser={currentUser}
        />
      )}

      {/* 批量新增會員表單 */}
      {showBatchAddForm && (
        <BatchAddMemberForm
          onSuccess={() => {
            setShowBatchAddForm(false);
            refreshMembers();
          }}
          onCancel={() => setShowBatchAddForm(false)}
          loginUser={currentUser}
        />
      )}

      {/* 編輯會員表單 */}
      {showEditForm && currentMember && (
        <EditMemberForm
          member={currentMember}
          onSuccess={() => {
            setShowEditForm(false);
            refreshMembers();
          }}
          onCancel={() => setShowEditForm(false)}
        />
      )}
    </div>
  );
};

export default MemberManagement;