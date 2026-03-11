import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "../../utils/cn";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "sm" | "md" | "lg";
}

/**
 * 图标按钮组件
 * 用于只包含图标的按钮
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          // 基础样式
          "inline-flex items-center justify-center rounded-full transition",
          "text-stone-700 hover:bg-stone-100",
          "disabled:cursor-not-allowed disabled:opacity-45",
          // 尺寸样式
          size === "sm" && "h-7 w-7",
          size === "md" && "h-8 w-8",
          size === "lg" && "h-10 w-10",
          className
        )}
        {...props}
      />
    );
  }
);

IconButton.displayName = "IconButton";
