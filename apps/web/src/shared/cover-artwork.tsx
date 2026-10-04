interface Props { cover?: string; fallback: string }
export default function CoverArtwork({ cover, fallback }: Props) {
  return cover?.startsWith('/api/covers/')
    ? <img className="cover-image" src={cover} alt="故事封面" />
    : <span>{cover || fallback}</span>;
}
