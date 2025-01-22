import * as React from "react";
import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import { cn } from "@/lib/utils";

const HoverCard = ({ delayDuration = 500, ...props }) => {
  const [isTouchDevice, setIsTouchDevice] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    setIsTouchDevice(isTouch);
  }, []);

  const handleOutsideClick = (e) => {
    if (!e.target.closest("[data-hover-card]")) {
      setOpen(false);
    }
  };

  React.useEffect(() => {
    if (isTouchDevice) {
      document.addEventListener("touchstart", handleOutsideClick);
      return () => {
        document.removeEventListener("touchstart", handleOutsideClick);
      };
    }
  }, [isTouchDevice]);

  return (
    <HoverCardPrimitive.Root
      open={isTouchDevice ? open : undefined}
      onOpenChange={(newState) => {
        if (!isTouchDevice) setOpen(newState);
      }}
      openDelay={isTouchDevice ? undefined : delayDuration}
      closeDelay={isTouchDevice ? undefined : 300}
      {...props}
    >
      {React.Children.map(props.children, (child) =>
        React.isValidElement(child)
          ? React.cloneElement(child, {
              setOpen: setOpen,
              isTouchDevice: isTouchDevice,
            })
          : child
      )}
    </HoverCardPrimitive.Root>
  );
};

const HoverCardTrigger = ({
  children,
  onLongPressDuration = 1000,
  setOpen,
  isTouchDevice,
  ...props
}) => {
  const longPressTimer = React.useRef(null);

  const handleTouchStart = () => {
    if (isTouchDevice) {
      longPressTimer.current = setTimeout(() => {
        setOpen(true);
      }, onLongPressDuration);
    }
  };

  const handleTouchEnd = () => {
    if (isTouchDevice) {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
      }
    }
  };

  // Filter out the `setOpen` and `isTouchDevice` props
  const { setOpen: _, isTouchDevice: __, ...restProps } = props;

  return (
    <HoverCardPrimitive.Trigger
      {...restProps}
      onMouseEnter={!isTouchDevice ? props.onMouseEnter : undefined}
      onMouseLeave={!isTouchDevice ? props.onMouseLeave : undefined}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      data-hover-card
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
    data-hover-card
    {...props}
  />
));
HoverCardContent.displayName = HoverCardPrimitive.Content.displayName;

export { HoverCard, HoverCardTrigger, HoverCardContent };
