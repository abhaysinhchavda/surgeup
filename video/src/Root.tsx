import { Composition } from "remotion";
import { SurgeUpDemo } from "./SurgeUpDemo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="SurgeUpDemo"
        component={SurgeUpDemo}
        durationInFrames={4350}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
