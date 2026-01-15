interface CalculatorIconProps {
  size?: number;
}

export const CalculatorIcon = ({ size = 40 }: CalculatorIconProps) => {
  return (
    <div
      className="flex items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-orange-600"
      style={{ width: size, height: size }}
    >
      <svg
        width={size * 0.6}
        height={size * 0.6}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect x="4" y="2" width="16" height="20" rx="2" fill="white" />
        <rect x="6" y="4" width="12" height="5" rx="1" fill="#1e293b" />
        <circle cx="8" cy="12" r="1.2" fill="#1e293b" />
        <circle cx="12" cy="12" r="1.2" fill="#1e293b" />
        <circle cx="16" cy="12" r="1.2" fill="#1e293b" />
        <circle cx="8" cy="16" r="1.2" fill="#1e293b" />
        <circle cx="12" cy="16" r="1.2" fill="#1e293b" />
        <circle cx="16" cy="16" r="1.2" fill="#1e293b" />
        <circle cx="8" cy="20" r="1.2" fill="#1e293b" />
        <circle cx="12" cy="20" r="1.2" fill="#1e293b" />
        <circle cx="16" cy="20" r="1.2" fill="#1e293b" />
      </svg>
    </div>
  );
};
