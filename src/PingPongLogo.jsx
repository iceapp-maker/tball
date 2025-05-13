import React from 'react';

function PingPongLogo() {
  return (
    <div className="w-64 h-32 bg-white rounded-lg shadow-md flex items-center justify-center">
      <div className="flex flex-col items-center">
        <div className="flex items-center mb-2">
          <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center">
            <span className="text-white text-xs">球</span>
          </div>
          <div className="w-16 h-1 bg-gray-400"></div>
          <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
            <span className="text-white text-xs">拍</span>
          </div>
        </div>
        <div className="text-gray-800 font-bold">乒乓球比賽</div>
      </div>
    </div>
  );
}

export default PingPongLogo;