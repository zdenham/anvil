interface MortLogoProps {
  /** Font size in pixels. Default 6 */
  size?: number;
  /** CSS color class for the logo. Default "text-surface-100" */
  className?: string;
}

export function MortLogo({ size = 6, className = "text-surface-100" }: MortLogoProps) {
  return (
    <pre
      className={`${className} select-none`}
      style={{
        fontFamily: 'SF Mono, Menlo, monospace',
        fontSize: `${size}px`,
        lineHeight: `${size}px`,
        transform: 'scaleY(1.25)',
      }}
    >{`  ▄▀▀▀▄
 █ ◠◡◠ █
  ▀▄▄▄▀`}</pre>
  );
}
