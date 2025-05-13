import React from 'react';

interface StatusSwitchProps {
  value: string; // 當前狀態
  options: [string, string, string]; // 三個狀態文字（如 ['已接受', '尚未回覆', '已拒絕']）
  onChange: (newStatus: string) => void; // 切換狀態時的 callback
}

const StatusSwitch: React.FC<StatusSwitchProps> = ({ value, options, onChange }) => {
  const idx = options.indexOf(value);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {options.map((option, i) => (
        <button
          key={option}
          style={{
            background: idx === i ? '#60a5fa' : '#e5e7eb',
            color: idx === i ? '#fff' : '#333',
            border: 'none',
            borderRadius: '16px',
            margin: '0 2px',
            padding: '4px 12px',
            cursor: 'pointer',
            fontWeight: idx === i ? 'bold' : 'normal',
            transition: 'background 0.2s, color 0.2s',
            minWidth: 48
          }}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
};

export default StatusSwitch;
