import type { MirrorSettings } from "../../types/settings";
import "./CalibrationOverlay.scss";

type CalibrationOverlayProps = {
  settings: MirrorSettings;
};

export function CalibrationOverlay({ settings }: CalibrationOverlayProps) {
  return (
    <div className="calibration-overlay">
      <div className="calibration-overlay__outer" />

      <div
        className="calibration-overlay__safe"
        style={{
          top: settings.layoutPaddingTopPx,
          right: settings.layoutPaddingRightPx,
          bottom: settings.layoutPaddingBottomPx,
          left: settings.layoutPaddingLeftPx,
        }}
      />

      <div className="calibration-overlay__info">
        <strong>CALIBRATION MODE</strong>
        <br />
        top: {settings.layoutPaddingTopPx}px
        <br />
        right: {settings.layoutPaddingRightPx}px
        <br />
        bottom: {settings.layoutPaddingBottomPx}px
        <br />
        left: {settings.layoutPaddingLeftPx}px
      </div>
    </div>
  );
}