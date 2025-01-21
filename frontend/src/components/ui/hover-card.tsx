import * as React from "react";
import * as HoverCardPrimitive from "@radix-ui/react-hover-card";

import { cn } from "@/lib/utils";

const HoverCard = ({ delayDuration = 300, ...props }) => {
  const [isTouchDevice, setIsTouchDevice] = React.useState(false);

  React.useEffect(() => {
    // Check if the device is touch-enabled
    const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    setIsTouchDevice(isTouch);
  }, []);

  return (
    <HoverCardPrimitive.Root
      openDelay={isTouchDevice ? undefined : delayDuration}
      {...props}
    />
  );
};

const HoverCardTrigger = ({ children, onLongPressDuration = 500, ...props }) => {
  const [isLongPress, setIsLongPress] = React.useState(false);
  const longPressTimer = React.useRef(null);

  const handleTouchStart = () => {
    longPressTimer.current = setTimeout(() => {
      setIsLongPress(true);
    }, onLongPressDuration);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
    setIsLongPress(false);
  };

  return (
    <HoverCardPrimitive.Trigger
      {...props}
      onMouseEnter={!isLongPress ? props.onMouseEnter : undefined}
      onMouseLeave={!isLongPress ? props.onMouseLeave : undefined}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {children}
    </HoverCardPrimitive.Trigger>
  );
};

const HoverCardContent = React.forwardRef<
  React.ElementRef<typeof HoverCardPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof HoverCardPrimitive.Content>
>(({ className, align = "start", sideOffset = 8, ...props }, ref) => (
  <HoverCardPrimitive.Content
    ref={ref}
    align={align}
    sideOffset={sideOffset}
    className={cn(
      "z-50 w-64 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none overflow-y-auto",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
      "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2",
      "data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className
    )}
    {...props}
  />
));
HoverCardContent.displayName = HoverCardPrimitive.Content.displayName;

export { HoverCard, HoverCardTrigger, HoverCardContent };
